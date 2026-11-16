/**
 * PASMANTAB e-VOTING 2026 — Admin Dashboard Controller
 */
window.__ADMIN_DASHBOARD_READY__ = true;

(function () {
  const Utils = window.PasmantabUtils;
  const SbService = window.SupabaseService;

  let supabase = null;
  let currentAdmin = null;
  let currentSettings = null;
  let cachedCandidates = [];
  let cachedVoters = [];
  let latestTally = null;

  const TAB_TITLES = {
    overview: "Overview Pemilihan",
    candidates: "Manajemen Calon Ketua",
    voters: "Daftar Pemilih Tetap (DPT)",
    tokens: "Token Pemilihan & QR Code",
    "election-control": "Kontrol Tahapan & Jadwal",
    results: "Rekapitulasi Perolehan Suara",
    reports: "Laporan & Berita Acara",
    "audit-logs": "Audit Trail Aktivitas",
    settings: "Pengaturan Organisasi"
  };

  function notify(type, message) {
    Utils.showAlert("global-admin-alert", type, message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function generateRandomTokenCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const arr = new Uint8Array(10);
    crypto.getRandomValues(arr);
    let part1 = "";
    let part2 = "";
    for (let i = 0; i < 5; i++) part1 += chars[arr[i] % chars.length];
    for (let i = 5; i < 10; i++) part2 += chars[arr[i] % chars.length];
    return `PSM-${part1}-${part2}`;
  }

  function toLocalDatetimeInputValue(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function logAudit(action, entityType, entityId = null, metadata = {}) {
    if (!supabase || !currentAdmin) return;
    try {
      await supabase.from("audit_logs").insert({
        admin_id: currentAdmin.id,
        action,
        entity_type: entityType,
        entity_id: entityId,
        metadata
      });
    } catch (_) {}
  }

  function bindNavigationAndModals() {
    const sidebar = document.getElementById("admin-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const mobileBtn = document.getElementById("btn-mobile-menu");

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("show");
    }

    if (mobileBtn) {
      mobileBtn.addEventListener("click", () => {
        if (sidebar) sidebar.classList.toggle("open");
        if (backdrop) backdrop.classList.toggle("show");
      });
    }

    if (backdrop) {
      backdrop.addEventListener("click", closeSidebar);
    }

    document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        if (!targetTab) return;

        document.querySelectorAll(".nav-item[data-tab]").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".admin-tab-panel").forEach((panel) => {
          panel.classList.add("hidden");
        });

        const activePanel = document.getElementById(`tab-${targetTab}`);
        if (activePanel) activePanel.classList.remove("hidden");

        const titleEl = document.getElementById("topbar-page-title");
        if (titleEl) titleEl.textContent = TAB_TITLES[targetTab] || "Dashboard Panitia";

        Utils.hideAlert("global-admin-alert");
        closeSidebar();

        if (targetTab === "results" || targetTab === "overview") {
          loadOverviewAndTally().catch(() => {});
        } else if (targetTab === "audit-logs") {
          loadAuditLogs().catch(() => {});
        }
      });
    });

    document.querySelectorAll(".js-close-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-modal");
        const modalEl = document.getElementById(modalId);
        if (modalEl) modalEl.classList.add("hidden");
      });
    });
  }

  function renderStatusBadge(status) {
    const badge = document.getElementById("topbar-election-status");
    if (!badge) return;

    const map = {
      SETUP: { cls: "badge badge-neutral", label: "SETUP" },
      SCHEDULED: { cls: "badge badge-scheduled", label: "TERJADWAL" },
      OPEN: { cls: "badge badge-open", label: "BERLANGSUNG (OPEN)" },
      CLOSED: { cls: "badge badge-closed", label: "DITUTUP (CLOSED)" },
      RESULTS_PUBLISHED: { cls: "badge badge-open", label: "HASIL DIPUBLIKASIKAN" }
    };
    const info = map[status] || { cls: "badge badge-neutral", label: status || "-" };
    badge.className = info.cls;
    badge.textContent = info.label;
  }

  async function loadSettings() {
    const { data, error } = await supabase
      .from("election_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;
    currentSettings = data;
    renderStatusBadge(data.status);

    const orgInput = document.getElementById("setting-org-name");
    const periodInput = document.getElementById("setting-period-label");
    const startInput = document.getElementById("input-start-at");
    const endInput = document.getElementById("input-end-at");

    if (orgInput) orgInput.value = data.org_name || "PASKIBRA MAN 4 BANJAR";
    if (periodInput) periodInput.value = data.period_label || "2026/2027";
    if (startInput) startInput.value = toLocalDatetimeInputValue(data.start_at);
    if (endInput) endInput.value = toLocalDatetimeInputValue(data.end_at);
  }

  async function loadOverviewAndTally() {
    const { data: tally, error } = await supabase.rpc("get_election_tally");
    if (error) throw error;

    latestTally = tally;
    const totalDpt = Number(tally.total_eligible_voters) || 0;
    const totalVoted = Number(tally.total_voted) || 0;
    const remaining = Math.max(totalDpt - totalVoted, 0);
    const rate = Number(tally.participation_rate) || 0;

    document.getElementById("stat-total-voters").textContent = String(totalDpt);
    document.getElementById("stat-completed-voters").textContent = String(totalVoted);
    document.getElementById("stat-remaining-voters").textContent = String(remaining);
    document.getElementById("stat-participation-rate").textContent = `${rate}%`;
    document.getElementById("overview-progress-text").textContent = `${totalVoted} / ${totalDpt} Anggota`;
    document.getElementById("overview-progress-bar").style.width = `${Math.min(rate, 100)}%`;

    document.getElementById("res-total-valid").textContent = String(totalVoted);
    document.getElementById("res-total-dpt").textContent = String(totalDpt);
    document.getElementById("res-participation").textContent = `${rate}%`;

    const breakdownCard = document.getElementById("results-breakdown-card");
    const items = tally.chairperson || [];

    if (items.length === 0) {
      breakdownCard.innerHTML = '<p class="text-muted">Belum ada kandidat Ketua yang terdaftar.</p>';
      return;
    }

    breakdownCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
        <h2 style="font-size:1.1rem;">Rincian Perolehan Suara Calon Ketua</h2>
        <a href="./live-count.html" class="btn btn-burgundy btn-sm">Buka Mode Proyektor (Live Count)</a>
      </div>
      ${items
        .map(
          (c) => `
          <div style="padding:1rem 0; border-bottom:1px solid var(--color-border);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
              <div>
                <span style="font-weight:800; color:var(--color-burgundy);">#${String(c.candidate_number).padStart(2, "0")}</span>
                <strong style="margin-left:0.4rem; font-size:1.05rem;">${Utils.escapeHTML(c.full_name)}</strong>
              </div>
              <div style="text-align:right;">
                <strong style="font-size:1.05rem;">${c.votes} suara</strong>
                <span class="text-muted" style="font-size:0.85rem;">(${c.percentage}%)</span>
              </div>
            </div>
            <div class="progress-track mt-1">
              <div class="progress-fill" style="width:${Math.min(Number(c.percentage) || 0, 100)}%;"></div>
            </div>
          </div>
        `
        )
        .join("")}
    `;
  }

  function openCandidateModal(candidateId = null) {
    const form = document.getElementById("form-candidate");
    form.reset();
    document.getElementById("cand-id").value = "";
    document.getElementById("cand-photo-url").value = "";

    if (candidateId) {
      const cand = cachedCandidates.find((c) => c.id === candidateId);
      if (!cand) return;
      document.getElementById("modal-candidate-title").textContent = "Edit Calon Ketua";
      document.getElementById("cand-id").value = cand.id;
      document.getElementById("cand-number").value = cand.candidate_number;
      document.getElementById("cand-name").value = cand.full_name;
      document.getElementById("cand-photo-url").value = cand.photo_url || "";
      document.getElementById("cand-vision").value = cand.vision;
      document.getElementById("cand-mission").value = cand.mission;
      document.getElementById("cand-program").value = cand.flagship_program || "";
      document.getElementById("cand-active").checked = Boolean(cand.is_active);
    } else {
      document.getElementById("modal-candidate-title").textContent = "Tambah Calon Ketua";
      document.getElementById("cand-number").value = cachedCandidates.length + 1;
      document.getElementById("cand-active").checked = true;
    }

    document.getElementById("modal-candidate").classList.remove("hidden");
  }

  async function loadCandidates() {
    const { data, error } = await supabase
      .from("candidates")
      .select("*")
      .eq("position", "CHAIRPERSON")
      .order("candidate_number", { ascending: true });

    if (error) throw error;
    cachedCandidates = data || [];

    const container = document.getElementById("candidates-list-admin");
    if (cachedCandidates.length === 0) {
      container.innerHTML =
        '<div class="card"><p class="text-muted">Belum ada calon Ketua. Klik <strong>+ Tambah Calon Ketua</strong> untuk memulai.</p></div>';
      return;
    }

    container.innerHTML = cachedCandidates
      .map((c) => {
        const num = String(c.candidate_number).padStart(2, "0");
        const badgeStatus = c.is_active
          ? '<span class="badge badge-open">Aktif</span>'
          : '<span class="badge badge-closed">Nonaktif</span>';

        return `
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.75rem; margin-bottom:0.75rem;">
              <div style="display:flex; align-items:center; gap:0.75rem;">
                ${
                  c.photo_url
                    ? `<img src="${Utils.escapeHTML(c.photo_url)}" alt="Foto" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid var(--color-border);" />`
                    : `<div style="width:56px;height:56px;border-radius:8px;background:var(--color-burgundy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;">#${num}</div>`
                }
                <div>
                  <span style="font-size:0.75rem; font-weight:700; color:var(--color-muted-gray);">NOMOR URUT ${num}</span>
                  <h3 style="font-size:1.1rem;">${Utils.escapeHTML(c.full_name)}</h3>
                </div>
              </div>
              ${badgeStatus}
            </div>

            <p style="font-size:0.85rem; margin-bottom:0.5rem;"><strong>Visi:</strong> ${Utils.escapeHTML(c.vision)}</p>
            <p style="font-size:0.85rem; color:var(--color-text-secondary); white-space:pre-line;"><strong>Misi:</strong>\n${Utils.escapeHTML(c.mission)}</p>

            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:1.25rem; padding-top:0.875rem; border-top:1px solid var(--color-border);">
              <button type="button" class="btn btn-outline btn-sm js-edit-cand" data-id="${c.id}">Edit Profil</button>
              <button type="button" class="btn btn-outline btn-sm js-toggle-cand" data-id="${c.id}" data-active="${c.is_active}">
                ${c.is_active ? "Nonaktifkan" : "Aktifkan"}
              </button>
              <button type="button" class="btn btn-danger-outline btn-sm js-delete-cand" data-id="${c.id}" data-name="${Utils.escapeHTML(c.full_name)}">
                Hapus
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    container.querySelectorAll(".js-edit-cand").forEach((btn) => {
      btn.addEventListener("click", () => openCandidateModal(btn.getAttribute("data-id")));
    });

    container.querySelectorAll(".js-toggle-cand").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const currentlyActive = btn.getAttribute("data-active") === "true";
        try {
          const { error: upErr } = await supabase
            .from("candidates")
            .update({ is_active: !currentlyActive, updated_at: new Date().toISOString() })
            .eq("id", id);
          if (upErr) throw upErr;

          await logAudit("TOGGLE_CANDIDATE_ACTIVE", "candidates", id, { is_active: !currentlyActive });
          await loadCandidates();
          await loadOverviewAndTally();
          notify("success", "Status kandidat berhasil diperbarui.");
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });

    container.querySelectorAll(".js-delete-cand").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        if (!window.confirm(`Hapus permanen kandidat "${name}"?`)) return;

        try {
          const { error: delErr } = await supabase.from("candidates").delete().eq("id", id);
          if (delErr) {
            if (delErr.code === "23503") {
              notify("error", "Kandidat tidak bisa dihapus permanen karena sudah memiliki suara masuk. Gunakan tombol Nonaktifkan.");
              return;
            }
            throw delErr;
          }

          await logAudit("DELETE_CANDIDATE", "candidates", id, { full_name: name });
          await loadCandidates();
          await loadOverviewAndTally();
          notify("success", `Kandidat "${name}" berhasil dihapus.`);
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });
  }

  function renderVotersTable(keyword = "") {
    const tbody = document.getElementById("voters-table-body");
    const summaryEl = document.getElementById("voter-count-summary");
    const q = keyword.trim().toLowerCase();

    const filtered = cachedVoters.filter(
      (v) =>
        !q ||
        v.full_name.toLowerCase().includes(q) ||
        v.class_or_unit.toLowerCase().includes(q)
    );

    if (summaryEl) {
      summaryEl.textContent = `Menampilkan ${filtered.length} dari ${cachedVoters.length} anggota`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="text-center text-muted">Belum ada data anggota yang tercatat.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((v) => {
        const eligBadge = v.is_eligible
          ? '<span class="badge badge-open">Memenuhi Syarat</span>'
          : '<span class="badge badge-closed">Tidak Memenuhi Syarat</span>';
        const voteBadge = v.has_voted
          ? '<span class="badge badge-open">Sudah Memilih</span>'
          : '<span class="badge badge-neutral">Belum Memilih</span>';

        return `
          <tr>
            <td><strong>${Utils.escapeHTML(v.full_name)}</strong></td>
            <td>${Utils.escapeHTML(v.class_or_unit)}</td>
            <td>${eligBadge}</td>
            <td>${voteBadge}</td>
            <td>
              <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                <button type="button" class="btn btn-outline btn-sm js-edit-voter" data-id="${v.id}">Edit</button>
                <button type="button" class="btn btn-danger-outline btn-sm js-del-voter" data-id="${v.id}" data-name="${Utils.escapeHTML(v.full_name)}">Hapus</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll(".js-edit-voter").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const voter = cachedVoters.find((v) => v.id === id);
        if (!voter) return;
        document.getElementById("modal-voter-title").textContent = "Edit Data Anggota";
        document.getElementById("voter-id").value = voter.id;
        document.getElementById("voter-fullname").value = voter.full_name;
        document.getElementById("voter-class").value = voter.class_or_unit;
        document.getElementById("voter-eligible").checked = Boolean(voter.is_eligible);
        document.getElementById("modal-voter").classList.remove("hidden");
      });
    });

    tbody.querySelectorAll(".js-del-voter").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        if (!window.confirm(`Hapus anggota "${name}" dari daftar?`)) return;
        try {
          const { error } = await supabase.from("voters").delete().eq("id", id);
          if (error) throw error;
          await logAudit("DELETE_VOTER", "voters", id, { full_name: name });
          await loadVoters();
          await loadOverviewAndTally();
          notify("success", `Data anggota "${name}" berhasil dihapus.`);
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });
  }

  async function loadVoters() {
    const { data, error } = await supabase
      .from("voters")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    cachedVoters = data || [];
    const searchVal = (document.getElementById("voter-search-input") || {}).value || "";
    renderVotersTable(searchVal);
  }

  async function loadActiveTokenMetadata() {
    const box = document.getElementById("active-token-metadata-box");
    const { data, error } = await supabase
      .from("voting_tokens")
      .select("*")
      .eq("is_revoked", false)
      .order("issued_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      box.innerHTML = '<div class="alert alert-warning">Belum ada token aktif. Buat token baru di atas sebelum membuka pemilihan.</div>';
      return;
    }

    const tok = data[0];
    const isExpired = new Date(tok.expires_at) <= new Date();

    box.innerHTML = `
      <div style="padding:0.9rem; border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-canvas);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
          <strong>${Utils.escapeHTML(tok.label || "Token Pemilihan")}</strong>
          ${
            isExpired
              ? '<span class="badge badge-closed">Kedaluwarsa</span>'
              : '<span class="badge badge-open">Aktif</span>'
          }
        </div>
        <div style="font-size:0.82rem; color:var(--color-text-secondary); margin-bottom:0.75rem;">
          Dibuat: ${Utils.formatDateTime(tok.issued_at)}<br />
          Berlaku hingga: <strong>${Utils.formatDateTime(tok.expires_at)}</strong>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" id="btn-open-expiry-modal" class="btn btn-outline btn-sm" data-id="${tok.id}" data-exp="${tok.expires_at}">
            Ubah Kedaluwarsa
          </button>
          <button type="button" id="btn-revoke-token" class="btn btn-danger-outline btn-sm" data-id="${tok.id}">
            Cabut Token Sekarang
          </button>
        </div>
      </div>
    `;

    const expBtn = document.getElementById("btn-open-expiry-modal");
    if (expBtn) {
      expBtn.addEventListener("click", () => {
        document.getElementById("expiry-token-id").value = tok.id;
        document.getElementById("new-expiry-datetime").value = toLocalDatetimeInputValue(tok.expires_at);
        document.getElementById("modal-token-expiry").classList.remove("hidden");
      });
    }

    const revBtn = document.getElementById("btn-revoke-token");
    if (revBtn) {
      revBtn.addEventListener("click", async () => {
        if (!window.confirm("Cabut token aktif ini sekarang? Pemilih tidak akan bisa masuk sebelum token baru dibuat.")) return;
        try {
          const { error: revErr } = await supabase
            .from("voting_tokens")
            .update({ is_revoked: true })
            .eq("id", tok.id);
          if (revErr) throw revErr;

          await logAudit("REVOKE_TOKEN", "voting_tokens", tok.id, {});
          document.getElementById("qr-print-area").classList.add("hidden");
          document.getElementById("qr-print-actions").classList.add("hidden");
          document.getElementById("qr-empty-state").classList.remove("hidden");
          await loadActiveTokenMetadata();
          notify("success", "Token berhasil dicabut.");
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    }
  }

  function renderQRPoster(rawToken, expiresAtIso) {
    document.getElementById("qr-empty-state").classList.add("hidden");
    document.getElementById("qr-print-area").classList.remove("hidden");
    document.getElementById("qr-print-actions").classList.remove("hidden");

    document.getElementById("qr-raw-token-text").textContent = rawToken;
    document.getElementById("qr-expiry-text").textContent = `Berlaku hingga: ${Utils.formatDateTime(expiresAtIso)}`;

    const holder = document.getElementById("qrcode-canvas");
    holder.innerHTML = "";
    if (window.QRCode) {
      new window.QRCode(holder, {
        text: rawToken,
        width: 210,
        height: 210,
        colorDark: "#18181B",
        colorLight: "#FFFFFF",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  }

  async function loadAuditLogs() {
    const tbody = document.getElementById("audit-logs-body");
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Belum ada catatan aktivitas.</td></tr>';
      return;
    }

    tbody.innerHTML = data
      .map(
        (row) => `
        <tr>
          <td style="white-space:nowrap;">${Utils.formatDateTime(row.created_at)}</td>
          <td><strong>${Utils.escapeHTML(row.action)}</strong></td>
          <td>${Utils.escapeHTML(row.entity_type || "-")}</td>
          <td style="font-family:var(--font-mono); font-size:0.78rem;">${Utils.escapeHTML(JSON.stringify(row.metadata || {}))}</td>
        </tr>
      `
      )
      .join("");
  }

  function bindReportActions() {
    document.getElementById("btn-download-csv").addEventListener("click", async () => {
      try {
        await loadOverviewAndTally();
        const items = (latestTally && latestTally.chairperson) || [];
        const lines = [
          "Nomor Urut,Nama Calon Ketua,Perolehan Suara,Persentase (%)",
          ...items.map(
            (c) => `${c.candidate_number},"${c.full_name.replace(/"/g, '""')}",${c.votes},${c.percentage}`
          ),
          "",
          `Total Pemilih Hadir,${latestTally.total_voted}`,
          `Waktu Unduh,"${Utils.formatDateTime(new Date().toISOString())}"`
        ];
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Rekap_PASMANTAB_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        await logAudit("EXPORT_CSV_REPORT", "reports", null, {});
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-download-pdf").addEventListener("click", async () => {
      try {
        await loadOverviewAndTally();
        if (!window.jspdf || !window.jspdf.jsPDF) {
          notify("error", "Library PDF belum siap. Muat ulang halaman lalu coba kembali.");
          return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const orgName = (currentSettings && currentSettings.org_name) || "PASKIBRA MAN 4 BANJAR";
        const period = (currentSettings && currentSettings.period_label) || "2026/2027";
        const items = (latestTally && latestTally.chairperson) || [];

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("BERITA ACARA PEMUNGUTAN & PENGHITUNGAN SUARA", 105, 22, { align: "center" });
        doc.setFontSize(11);
        doc.text(`${orgName} — PERIODE ${period}`, 105, 29, { align: "center" });

        doc.setLineWidth(0.5);
        doc.line(20, 34, 190, 34);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Dicetak pada: ${Utils.formatDateTime(new Date().toISOString())}`, 20, 43);
        doc.text(`Total Pemilih Menggunakan Hak Suara: ${latestTally.total_voted} Anggota`, 20, 49);

        let y = 62;
        doc.setFont("helvetica", "bold");
        doc.text("No. Urut", 20, y);
        doc.text("Nama Calon Ketua", 48, y);
        doc.text("Perolehan Suara", 135, y);
        doc.text("Persentase", 170, y);
        doc.line(20, y + 2, 190, y + 2);

        doc.setFont("helvetica", "normal");
        items.forEach((c) => {
          y += 9;
          doc.text(String(c.candidate_number).padStart(2, "0"), 24, y);
          doc.text(String(c.full_name), 48, y);
          doc.text(`${c.votes} suara`, 138, y);
          doc.text(`${c.percentage}%`, 172, y);
        });

        y += 26;
        doc.text("Mengetahui,", 135, y);
        doc.text("Ketua Panitia Pemilihan,", 135, y + 6);
        doc.text("( ________________________ )", 135, y + 28);

        doc.save(`Berita_Acara_PASMANTAB_${Date.now()}.pdf`);
        await logAudit("EXPORT_PDF_MINUTES", "reports", null, {});
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });
  }

  function bindFormActions() {
    document.getElementById("btn-admin-logout").addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.replace("./login.html");
    });

    document.getElementById("btn-refresh-overview").addEventListener("click", async () => {
      try {
        await loadOverviewAndTally();
        notify("success", "Data ringkasan berhasil diperbarui.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-refresh-results").addEventListener("click", async () => {
      try {
        await loadOverviewAndTally();
        notify("success", "Perolehan suara berhasil dihitung ulang.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-refresh-audit").addEventListener("click", async () => {
      try {
        await loadAuditLogs();
        notify("success", "Log audit berhasil diperbarui.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-open-add-candidate").addEventListener("click", () => openCandidateModal(null));

    document.getElementById("form-candidate").addEventListener("submit", async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById("btn-save-candidate");
      saveBtn.disabled = true;
      saveBtn.textContent = "Menyimpan...";

      try {
        const id = document.getElementById("cand-id").value;
        const candNumber = Number(document.getElementById("cand-number").value);
        const fullName = document.getElementById("cand-name").value.trim();
        const vision = document.getElementById("cand-vision").value.trim();
        const mission = document.getElementById("cand-mission").value.trim();
        const flagship = document.getElementById("cand-program").value.trim();
        const isActive = document.getElementById("cand-active").checked;
        let photoUrl = document.getElementById("cand-photo-url").value.trim() || null;

        const fileInput = document.getElementById("cand-photo-file");
        if (fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          const ext = file.name.split(".").pop() || "jpg";
          const filePath = `chairperson_${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("candidate-photos")
            .upload(filePath, file, { upsert: true });

          if (!upErr) {
            const { data: pubData } = supabase.storage
              .from("candidate-photos")
              .getPublicUrl(filePath);
            if (pubData && pubData.publicUrl) photoUrl = pubData.publicUrl;
          }
        }

        const payload = {
          position: "CHAIRPERSON",
          candidate_number: candNumber,
          full_name: fullName,
          photo_url: photoUrl,
          vision,
          mission,
          flagship_program: flagship || null,
          is_active: isActive,
          updated_at: new Date().toISOString()
        };

        if (id) {
          const { error } = await supabase.from("candidates").update(payload).eq("id", id);
          if (error) throw error;
          await logAudit("UPDATE_CANDIDATE", "candidates", id, { full_name: fullName });
        } else {
          const { error } = await supabase.from("candidates").insert(payload);
          if (error) throw error;
          await logAudit("CREATE_CANDIDATE", "candidates", null, { full_name: fullName });
        }

        document.getElementById("modal-candidate").classList.add("hidden");
        await loadCandidates();
        await loadOverviewAndTally();
        notify("success", "Data calon Ketua berhasil disimpan.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Simpan Kandidat";
      }
    });

    document.getElementById("voter-search-input").addEventListener("input", (e) => {
      renderVotersTable(e.target.value);
    });

    document.getElementById("btn-open-add-voter").addEventListener("click", () => {
      document.getElementById("form-voter").reset();
      document.getElementById("voter-id").value = "";
      document.getElementById("voter-eligible").checked = true;
      document.getElementById("modal-voter-title").textContent = "Tambah Anggota Pemilih";
      document.getElementById("modal-voter").classList.remove("hidden");
    });

    document.getElementById("form-voter").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const id = document.getElementById("voter-id").value;
        const fullName = document.getElementById("voter-fullname").value.trim().replace(/\s+/g, " ");
        const className = document.getElementById("voter-class").value.trim().replace(/\s+/g, " ").toUpperCase();
        const isEligible = document.getElementById("voter-eligible").checked;

        if (id) {
          const { error } = await supabase
            .from("voters")
            .update({ full_name: fullName, class_or_unit: className, is_eligible: isEligible, updated_at: new Date().toISOString() })
            .eq("id", id);
          if (error) throw error;
          await logAudit("UPDATE_VOTER", "voters", id, { full_name: fullName });
        } else {
          const { error } = await supabase
            .from("voters")
            .insert({ full_name: fullName, class_or_unit: className, is_eligible: isEligible });
          if (error) throw error;
          await logAudit("CREATE_VOTER", "voters", null, { full_name: fullName });
        }

        document.getElementById("modal-voter").classList.add("hidden");
        await loadVoters();
        await loadOverviewAndTally();
        notify("success", "Data anggota berhasil disimpan.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-open-import-csv").addEventListener("click", () => {
      const bulkEl = document.getElementById("bulk-paste-voters");
      if (bulkEl) bulkEl.value = "";
      document.getElementById("csv-file-input").value = "";
      document.getElementById("modal-import-csv").classList.remove("hidden");
    });

    document.getElementById("btn-process-csv").addEventListener("click", async () => {
      const bulkEl = document.getElementById("bulk-paste-voters");
      const fileInput = document.getElementById("csv-file-input");

      let rawText = bulkEl ? bulkEl.value.trim() : "";
      if (!rawText && fileInput.files && fileInput.files[0]) {
        rawText = await fileInput.files[0].text();
      }
      if (!rawText) {
        alert("Pilih file CSV atau tempel daftar nama terlebih dahulu.");
        return;
      }

      const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const existingSet = new Set(
        cachedVoters.map((v) => `${v.full_name.trim().toLowerCase()}|${v.class_or_unit.trim().toUpperCase()}`)
      );
      const rowsToInsert = [];

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(/[\t;,]/).map((p) => p.replace(/^"|"$/g, "").trim()).filter(Boolean);
        if (parts.length < 2) continue;
        if (i === 0 && parts[0].toLowerCase().includes("nama")) continue;

        const fullName = parts[0].replace(/\s+/g, " ");
        const className = parts[1].replace(/\s+/g, " ").toUpperCase();
        const key = `${fullName.toLowerCase()}|${className}`;

        if (!existingSet.has(key)) {
          existingSet.add(key);
          rowsToInsert.push({ full_name: fullName, class_or_unit: className, is_eligible: true });
        }
      }

      if (rowsToInsert.length === 0) {
        alert("Tidak ada baris baru untuk diimpor.");
        return;
      }

      try {
        const { error } = await supabase.from("voters").insert(rowsToInsert);
        if (error) throw error;
        await logAudit("IMPORT_VOTERS_BULK", "voters", null, { count: rowsToInsert.length });
        document.getElementById("modal-import-csv").classList.add("hidden");
        await loadVoters();
        await loadOverviewAndTally();
        notify("success", `Berhasil mengimpor ${rowsToInsert.length} anggota.`);
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("form-generate-token").addEventListener("submit", async (e) => {
      e.preventDefault();
      const genBtn = document.getElementById("btn-generate-token");
      genBtn.disabled = true;
      genBtn.textContent = "Membuat Token...";

      try {
        const label = document.getElementById("token-label-input").value.trim() || "Token Utama";
        const minutes = Number(document.getElementById("token-duration-select").value) || 120;
        const rawToken = generateRandomTokenCode();
        const saltBytes = new Uint8Array(12);
        crypto.getRandomValues(saltBytes);
        const tokenSalt = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        const tokenHash = await sha256Hex(`${tokenSalt}:${rawToken}`);
        const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

        await supabase
          .from("voting_tokens")
          .update({ is_revoked: true })
          .eq("is_revoked", false);

        const { error } = await supabase.from("voting_tokens").insert({
          label,
          token_salt: tokenSalt,
          token_hash: tokenHash,
          expires_at: expiresAt,
          is_revoked: false
        });
        if (error) throw error;

        await logAudit("GENERATE_VOTING_TOKEN", "voting_tokens", null, { label, expires_at: expiresAt });
        renderQRPoster(rawToken, expiresAt);
        await loadActiveTokenMetadata();
        notify("success", `Token baru berhasil diterbitkan: ${rawToken}`);
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = "BUAT TOKEN & QR CODE BARU";
      }
    });

    document.getElementById("form-update-expiry").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const tokenId = document.getElementById("expiry-token-id").value;
        const dtVal = document.getElementById("new-expiry-datetime").value;
        if (!dtVal) return;
        const isoExp = new Date(dtVal).toISOString();

        const { error } = await supabase
          .from("voting_tokens")
          .update({ expires_at: isoExp })
          .eq("id", tokenId);
        if (error) throw error;

        await logAudit("UPDATE_TOKEN_EXPIRY", "voting_tokens", tokenId, { expires_at: isoExp });
        document.getElementById("modal-token-expiry").classList.add("hidden");
        document.getElementById("qr-expiry-text").textContent = `Berlaku hingga: ${Utils.formatDateTime(isoExp)}`;
        await loadActiveTokenMetadata();
        notify("success", "Waktu kedaluwarsa token berhasil diperbarui.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("btn-print-qr").addEventListener("click", () => {
      window.print();
    });

    document.querySelectorAll(".js-status-action").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const targetStatus = btn.getAttribute("data-target-status");
        if (!window.confirm(`Ubah status pemilihan menjadi ${targetStatus}?`)) return;

        try {
          const { error } = await supabase
            .from("election_settings")
            .update({ status: targetStatus, updated_at: new Date().toISOString() })
            .eq("id", 1);
          if (error) throw error;

          await logAudit("CHANGE_ELECTION_STATUS", "election_settings", null, { status: targetStatus });
          await loadSettings();
          notify("success", `Status pemilihan berhasil diubah menjadi ${targetStatus}.`);
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });

    document.getElementById("form-election-schedule").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const startVal = document.getElementById("input-start-at").value;
        const endVal = document.getElementById("input-end-at").value;

        const { error } = await supabase
          .from("election_settings")
          .update({
            start_at: startVal ? new Date(startVal).toISOString() : null,
            end_at: endVal ? new Date(endVal).toISOString() : null,
            updated_at: new Date().toISOString()
          })
          .eq("id", 1);
        if (error) throw error;

        await logAudit("UPDATE_ELECTION_SCHEDULE", "election_settings", null, { start_at: startVal, end_at: endVal });
        await loadSettings();
        notify("success", "Jadwal pemilihan berhasil disimpan.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });

    document.getElementById("form-org-settings").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const orgName = document.getElementById("setting-org-name").value.trim();
        const periodLabel = document.getElementById("setting-period-label").value.trim();

        const { error } = await supabase
          .from("election_settings")
          .update({ org_name: orgName, period_label: periodLabel, updated_at: new Date().toISOString() })
          .eq("id", 1);
        if (error) throw error;

        await logAudit("UPDATE_ORG_SETTINGS", "election_settings", null, { org_name: orgName, period_label: periodLabel });
        await loadSettings();
        notify("success", "Pengaturan organisasi berhasil diperbarui.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindNavigationAndModals();

    try {
      supabase = SbService.getClient();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData || !sessionData.session) {
        window.location.replace("./login.html");
        return;
      }

      const { data: adminProfile, error: adminErr } = await supabase
        .from("admin_users")
        .select("*")
        .eq("id", sessionData.session.user.id)
        .eq("is_active", true)
        .single();

      if (adminErr || !adminProfile) {
        await supabase.auth.signOut();
        window.location.replace("./login.html");
        return;
      }

      currentAdmin = adminProfile;
      const adminNameEl = document.getElementById("topbar-admin-name");
      if (adminNameEl) {
        adminNameEl.textContent = `${adminProfile.full_name} (${adminProfile.role})`;
      }

      bindFormActions();
      bindReportActions();

      await Promise.all([
        loadSettings(),
        loadOverviewAndTally(),
        loadCandidates(),
        loadVoters(),
        loadActiveTokenMetadata(),
        loadAuditLogs()
      ]);
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  });
})();

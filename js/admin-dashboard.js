/**
 * PASMANTAB e-VOTING 2026 — Admin Dashboard Controller (10 Menus Complete)
 */
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
    return `PSM-${part1}-${part2}`; }  function toLocalDatetimeInputValue(isoString) { if (!isoString) return ""; const d = new Date(isoString); if (Number.isNaN(d.getTime())) return ""; const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    } catch (_) {
      // Jangan menggagalkan aksi utama jika logging minor gagal
    }
  }

  // ==========================================================================
  // 1. NAVIGASI SIDEBAR & MODAL (DIPASANG PERTAMA AGAR SELALU RESPONSIF)
  // ==========================================================================
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

        const activePanel = document.getElementById(`tab-${targetTab}`); if (activePanel) activePanel.classList.remove("hidden");  const titleEl = document.getElementById("topbar-page-title"); if (titleEl) titleEl.textContent = TAB_TITLES[targetTab] \vert{}\vert{} "Dashboard Panitia";  Utils.hideAlert("global-admin-alert"); closeSidebar();  if (targetTab === "results" \vert{}\vert{} targetTab === "overview") { loadOverviewAndTally().catch(() => {}); } else if (targetTab === "audit-logs") { loadAuditLogs().catch(() => {}); } }); });  document.querySelectorAll(".js-close-modal").forEach((btn) => { btn.addEventListener("click", () => { const modalId = btn.getAttribute("data-modal"); const modalEl = document.getElementById(modalId); if (modalEl) modalEl.classList.add("hidden"); }); }); }  // ========================================================================== // 2. SETTINGS & ELECTION STATUS // ========================================================================== function renderStatusBadge(status) { const badge = document.getElementById("topbar-election-status"); if (!badge) return;  const map = { SETUP: { cls: "badge badge-neutral", label: "SETUP" }, SCHEDULED: { cls: "badge badge-scheduled", label: "TERJADWAL" }, OPEN: { cls: "badge badge-open", label: "BERLANGSUNG (OPEN)" }, CLOSED: { cls: "badge badge-closed", label: "DITUTUP (CLOSED)" }, RESULTS_PUBLISHED: { cls: "badge badge-open", label: "HASIL DIPUBLIKASIKAN" } }; const info = map[status] \vert{}\vert{} { cls: "badge badge-neutral", label: status \vert{}\vert{} "-" }; badge.className = info.cls; badge.textContent = info.label; }  async function loadSettings() { const { data, error } = await supabase .from("election_settings") .select("*") .eq("id", 1) .single();  if (error) throw error; currentSettings = data; renderStatusBadge(data.status);  const orgInput = document.getElementById("setting-org-name"); const periodInput = document.getElementById("setting-period-label"); const startInput = document.getElementById("input-start-at"); const endInput = document.getElementById("input-end-at");  if (orgInput) orgInput.value = data.org_name \vert{}\vert{} "PASKIBRA MAN 4 BANJAR"; if (periodInput) periodInput.value = data.period_label \vert{}\vert{} "2026/2027"; if (startInput) startInput.value = toLocalDatetimeInputValue(data.start_at); if (endInput) endInput.value = toLocalDatetimeInputValue(data.end_at); }  // ========================================================================== // 3. OVERVIEW & RESULTS TALLY // ========================================================================== async function loadOverviewAndTally() { const { data: tally, error } = await supabase.rpc("get_election_tally"); if (error) throw error;  latestTally = tally; const totalDpt = Number(tally.total_eligible_voters) \vert{}\vert{} 0; const totalVoted = Number(tally.total_voted) \vert{}\vert{} 0; const remaining = Math.max(totalDpt - totalVoted, 0); const rate = Number(tally.participation_rate) \vert{}\vert{} 0;  document.getElementById("stat-total-voters").textContent = String(totalDpt); document.getElementById("stat-completed-voters").textContent = String(totalVoted); document.getElementById("stat-remaining-voters").textContent = String(remaining); document.getElementById("stat-participation-rate").textContent = `${rate}%`;
    document.getElementById("overview-progress-text").textContent = `${totalVoted} /${totalDpt} Anggota`;
    document.getElementById("overview-progress-bar").style.width = `${Math.min(rate, 100)}\%`;  document.getElementById("res-total-valid").textContent = String(totalVoted); document.getElementById("res-total-dpt").textContent = String(totalDpt); document.getElementById("res-participation").textContent = `${rate}%`;

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

  // ==========================================================================
  // 4. MANAJEMEN KANDIDAT (TAMBAH, EDIT, NONAKTIFKAN, HAPUS)
  // ==========================================================================
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
        if (!window.confirm(`Hapus permanen kandidat "${name}"?`)) return;  try { const { error: delErr } = await supabase.from("candidates").delete().eq("id", id); if (delErr) { if (delErr.code === "23503") { notify("error", "Kandidat tidak bisa dihapus permanen karena sudah memiliki suara masuk. Gunakan tombol Nonaktifkan."); return; } throw delErr; }  await logAudit("DELETE_CANDIDATE", "candidates", id, { full_name: name }); await loadCandidates(); await loadOverviewAndTally(); notify("success", `Kandidat "${name}" berhasil dihapus.`);
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });
  }

  // ==========================================================================
  // 5. DAFTAR PEMILIH (DPT / KEHADIRAN SELF-CHECK-IN)
  // ==========================================================================
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
      summaryEl.textContent = `Menampilkan ${filtered.length} dari${cachedVoters.length} anggota`;
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

  // ==========================================================================
  // 6. VOTING TOKENS & QR CODE GENERATOR
  // ==========================================================================
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
          <button type="button" id="btn-open-expiry-modal" class="btn btn-outline btn-sm" data-id="${tok.id}" data-exp="${

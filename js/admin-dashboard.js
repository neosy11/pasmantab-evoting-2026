/**
 * PASMANTAB e-VOTING 2026 — Admin Dashboard Controller
 * Mengelola seluruh 10 modul administrasi panitia secara aman.
 */
(function () {
  const Utils = window.PasmantabUtils;
  const SbService = window.SupabaseService;

  let supabase = null;
  let currentAdmin = null;
  let currentSettings = null;
  let cachedVoters = [];
  let cachedCandidates = [];
  let latestTally = null;

  const TAB_TITLES = {
    overview: "Overview Pemilihan",
    candidates: "Manajemen Calon Ketua",
    voters: "Daftar Pemilih Tetap (DPT)",
    tokens: "Token Pemilihan & QR Code",
    "election-control": "Kontrol Tahapan Pemilihan",
    results: "Rekapitulasi Suara Ketua",
    reports: "Laporan & Berita Acara",
    "audit-logs": "Audit Trail Aktivitas Panitia",
    settings: "Pengaturan Organisasi"
  };

  function notify(type, message) {
    Utils.showAlert("global-admin-alert", type, message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function logAudit(action, targetEntity, targetId, metadata) {
    try {
      await supabase.from("audit_logs").insert({
        actor_admin_id: currentAdmin.id,
        action,
        target_entity: targetEntity || null,
        target_id: targetId ? String(targetId) : null,
        metadata: metadata || {}
      });
    } catch (_) {
      // Jangan gagalkan UI jika log non-kritis tertunda
    }
  }

  // ==========================================================================
  // 1. INISIALISASI & RBAC GUARD
  // ==========================================================================
  async function initAdminDashboard() {
    try {
      supabase = SbService.getClient();
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr || !sessionData || !sessionData.session) {
        window.location.replace("./login.html");
        return;
      }

      const userId = sessionData.session.user.id;
      const { data: adminProfile, error: adminErr } = await supabase
        .from("admin_users")
        .select("*")
        .eq("id", userId)
        .single();

      if (adminErr || !adminProfile || !adminProfile.is_active) {
        await supabase.auth.signOut();
        window.location.replace("./login.html");
        return;
      }

      currentAdmin = adminProfile;
      document.getElementById("topbar-admin-name").textContent =
        `${adminProfile.full_name} (${adminProfile.role})`;

      setupNavigationAndModals();
      await loadSettingsAndStatus();
      await loadOverviewAndTally();
      await loadCandidates();
      await loadVoters();
      await loadActiveTokenMetadata();
      await loadAuditLogs();
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  }

  // ==========================================================================
  // 2. NAVIGASI SIDEBAR & MODAL CONTROLS
  // ==========================================================================
  function setupNavigationAndModals() {
    const sidebar = document.getElementById("admin-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const mobileMenuBtn = document.getElementById("btn-mobile-menu");

    function closeSidebar() {
      sidebar.classList.remove("open");
      backdrop.classList.remove("show");
    }

    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      backdrop.classList.toggle("show");
    });

    backdrop.addEventListener("click", closeSidebar);

    document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        document.querySelectorAll(".nav-item[data-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        document.querySelectorAll(".admin-tab-panel").forEach((panel) => panel.classList.add("hidden"));
        const targetPanel = document.getElementById(`tab-${targetTab}`);
        if (targetPanel) targetPanel.classList.remove("hidden");

        document.getElementById("topbar-page-title").textContent = TAB_TITLES[targetTab] || "Dashboard";
        Utils.hideAlert("global-admin-alert");
        closeSidebar();
      });
    });

    // Tutup modal
    document.querySelectorAll(".js-close-modal").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-modal");
        document.getElementById(modalId).classList.add("hidden");
      });
    });

    // Logout
    document.getElementById("btn-admin-logout").addEventListener("click", async () => {
      await logAudit("ADMIN_LOGOUT", "admin_users", currentAdmin.id, {});
      await supabase.auth.signOut();
      window.location.replace("./login.html");
    });
  }

  // ==========================================================================
  // 3. PENGATURAN & STATUS PEMILIHAN
  // ==========================================================================
  async function loadSettingsAndStatus() {
    const { data, error } = await supabase
      .from("election_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;
    currentSettings = data;

    const statusBadge = document.getElementById("topbar-election-status");
    statusBadge.textContent = data.status;
    statusBadge.className = "badge " + (
      data.status === "OPEN" ? "badge-open" :
      data.status === "CLOSED" || data.status === "RESULTS_PUBLISHED" ? "badge-closed" :
      "badge-scheduled"
    );

    // Isi form settings & jadwal
    document.getElementById("setting-org-name").value = data.organization_name || "";
    document.getElementById("setting-period-label").value = data.period_label || "";

    if (data.start_at) {
      document.getElementById("input-start-at").value = toLocalDatetimeInput(data.start_at);
    }
    if (data.end_at) {
      document.getElementById("input-end-at").value = toLocalDatetimeInput(data.end_at);
    }
  }

  function toLocalDatetimeInput(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  // ==========================================================================
  // 4. OVERVIEW & RESULTS TALLY
  // ==========================================================================
  async function loadOverviewAndTally() {
    const { data: tally, error } = await supabase.rpc("get_election_tally");
    if (error) throw error;
    latestTally = tally;

    // Update kartu Overview
    document.getElementById("stat-total-voters").textContent = tally.total_eligible_voters;
    document.getElementById("stat-completed-voters").textContent = tally.total_voted;
    document.getElementById("stat-remaining-voters").textContent = tally.remaining_voters;
    document.getElementById("stat-participation-rate").textContent = `${tally.participation_rate}%`;
    document.getElementById("overview-progress-text").textContent =
      `${tally.total_voted} / ${tally.total_eligible_voters} Anggota`;
    document.getElementById("overview-progress-bar").style.width =
      `${Math.min(Number(tally.participation_rate) || 0, 100)}%`;

    // Update kartu Results
    const chairList = tally.chairperson || [];
    const totalValidVotes = chairList.reduce((acc, item) => acc + (item.votes || 0), 0);

    document.getElementById("res-total-valid").textContent = totalValidVotes;
    document.getElementById("res-total-dpt").textContent = tally.total_eligible_voters;
    document.getElementById("res-participation").textContent = `${tally.participation_rate}%`;

    const breakdownCard = document.getElementById("results-breakdown-card");
    if (chairList.length === 0) {
      breakdownCard.innerHTML = '<p class="text-muted">Belum ada kandidat Ketua yang terdaftar.</p>';
      return;
    }

    breakdownCard.innerHTML = `
      <h2 style="font-size:1.1rem; margin-bottom:1rem;">Perolehan Suara per Calon Ketua</h2>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>No. Urut</th>
              <th>Nama Calon Ketua</th>
              <th>Jumlah Suara</th>
              <th>Persentase</th>
              <th style="width:220px;">Visual</th>
            </tr>
          </thead>
          <tbody>
            ${chairList
              .map(
                (c) => `
                <tr>
                  <td><strong>#${String(c.candidate_number).padStart(2, "0")}</strong></td>
                  <td><strong>${Utils.escapeHTML(c.full_name)}</strong></td>
                  <td><strong>${c.votes}</strong> suara</td>
                  <td>${c.percentage}%</td>
                  <td>
                    <div class="progress-track" style="height:10px;">
                      <div class="progress-fill" style="width:${Math.min(Number(c.percentage) || 0, 100)}%;"></div>
                    </div>
                  </td>
                </tr>
              `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  document.getElementById("btn-refresh-overview").addEventListener("click", async () => {
    await loadOverviewAndTally();
    notify("success", "Statistik partisipasi berhasil diperbarui.");
  });

  document.getElementById("btn-refresh-results").addEventListener("click", async () => {
    await loadOverviewAndTally();
    notify("success", "Rekapitulasi suara berhasil dihitung ulang.");
  });

  // ==========================================================================
  // 5. MANAJEMEN KANDIDAT KETUA (+ UPLOAD FOTO SUPABASE STORAGE)
  // ==========================================================================
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

            <div style="display:flex; gap:0.5rem; margin-top:1.25rem; padding-top:0.875rem; border-top:1px solid var(--color-border);">
              <button type="button" class="btn btn-outline btn-sm js-edit-cand" data-id="${c.id}">Edit Profil</button>
              <button type="button" class="btn btn-danger-outline btn-sm js-toggle-cand" data-id="${c.id}" data-active="${c.is_active}">
                ${c.is_active ? "Nonaktifkan" : "Aktifkan"}
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
  }

  function openCandidateModal(candidateId) {
    const form = document.getElementById("form-candidate");
    form.reset();
    document.getElementById("cand-id").value = "";
    document.getElementById("cand-photo-url").value = "";

    if (candidateId) {
      const cand = cachedCandidates.find((x) => x.id === candidateId);
      if (!cand) return;
      document.getElementById("modal-candidate-title").textContent = "Edit Calon Ketua";
      document.getElementById("cand-id").value = cand.id;
      document.getElementById("cand-number").value = cand.candidate_number;
      document.getElementById("cand-name").value = cand.full_name;
      document.getElementById("cand-photo-url").value = cand.photo_url || "";
      document.getElementById("cand-vision").value = cand.vision;
      document.getElementById("cand-mission").value = cand.mission;
      document.getElementById("cand-program").value = cand.flagship_program || "";
      document.getElementById("cand-active").checked = cand.is_active;
    } else {
      document.getElementById("modal-candidate-title").textContent = "Tambah Calon Ketua";
      document.getElementById("cand-number").value = cachedCandidates.length + 1;
      document.getElementById("cand-active").checked = true;
    }

    document.getElementById("modal-candidate").classList.remove("hidden");
  }

  document.getElementById("btn-open-add-candidate").addEventListener("click", () => {
    openCandidateModal(null);
  });

  document.getElementById("form-candidate").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("btn-save-candidate");
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";

    try {
      const id = document.getElementById("cand-id").value;
      const numberVal = parseInt(document.getElementById("cand-number").value, 10);
      const fullName = document.getElementById("cand-name").value.trim();
      const vision = document.getElementById("cand-vision").value.trim();
      const mission = document.getElementById("cand-mission").value.trim();
      const program = document.getElementById("cand-program").value.trim();
      const isActive = document.getElementById("cand-active").checked;
      let photoUrl = document.getElementById("cand-photo-url").value;

      const fileInput = document.getElementById("cand-photo-file");
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const ext = file.name.split(".").pop() || "jpg";
        const filePath = `chair_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("candidate-photos")
          .upload(filePath, file, { upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage
          .from("candidate-photos")
          .getPublicUrl(filePath);
        photoUrl = pubData.publicUrl;
      }

      const payload = {
        position: "CHAIRPERSON",
        candidate_number: numberVal,
        full_name: fullName,
        photo_url: photoUrl || null,
        vision,
        mission,
        flagship_program: program || null,
        is_active: isActive,
        updated_at: new Date().toISOString()
      };

      if (id) {
        const { error } = await supabase.from("candidates").update(payload).eq("id", id);
        if (error) throw error;
        await logAudit("UPDATE_CANDIDATE", "candidates", id, { candidate_number: numberVal, full_name: fullName });
      } else {
        const { data: inserted, error } = await supabase.from("candidates").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit("CREATE_CANDIDATE", "candidates", inserted.id, { candidate_number: numberVal, full_name: fullName });
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

  // ==========================================================================
  // 6. MANAJEMEN DAFTAR PEMILIH TETAP (DPT + IMPOR CSV)
  // ==========================================================================
  async function loadVoters() {
    const { data, error } = await supabase
      .from("voters")
      .select("id, full_name, class_or_unit, is_eligible, has_voted")
      .order("class_or_unit", { ascending: true })
      .order("full_name", { ascending: true });

    if (error) throw error;
    cachedVoters = data || [];
    renderVotersTable(cachedVoters);
  }

  function renderVotersTable(list) {
    const tbody = document.getElementById("voters-table-body");
    document.getElementById("voter-count-summary").textContent = `Menampilkan ${list.length} dari ${cachedVoters.length} anggota`;

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Belum ada data pemilih.</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map(
        (v) => `
        <tr>
          <td><strong>${Utils.escapeHTML(v.full_name)}</strong></td>
          <td>${Utils.escapeHTML(v.class_or_unit)}</td>
          <td>
            ${
              v.is_eligible
                ? '<span class="badge badge-open">Memenuhi Syarat</span>'
                : '<span class="badge badge-closed">Tidak Aktif</span>'
            }
          </td>
          <td>
            ${
              v.has_voted
                ? '<span class="badge badge-neutral">Sudah Memilih</span>'
                : '<span class="badge badge-scheduled">Belum Memilih</span>'
            }
          </td>
          <td>
            <div style="display:flex; gap:0.4rem;">
              <button type="button" class="btn btn-outline btn-sm js-edit-voter" data-id="${v.id}">Edit</button>
              ${
                !v.has_voted
                  ? `<button type="button" class="btn btn-danger-outline btn-sm js-delete-voter" data-id="${v.id}">Hapus</button>`
                  : ""
              }
            </div>
          </td>
        </tr>
      `
      )
      .join("");

    tbody.querySelectorAll(".js-edit-voter").forEach((btn) => {
      btn.addEventListener("click", () => openVoterModal(btn.getAttribute("data-id")));
    });

    tbody.querySelectorAll(".js-delete-voter").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!window.confirm("Hapus anggota ini dari Daftar Pemilih Tetap?")) return;
        try {
          const { error } = await supabase.from("voters").delete().eq("id", id);
          if (error) throw error;
          await logAudit("DELETE_VOTER", "voters", id, {});
          await loadVoters();
          await loadOverviewAndTally();
          notify("success", "Anggota berhasil dihapus dari DPT.");
        } catch (err) {
          notify("error", SbService.mapFriendlyError(err));
        }
      });
    });
  }

  document.getElementById("voter-search-input").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = cachedVoters.filter(
      (v) =>
        v.full_name.toLowerCase().includes(q) ||
        v.class_or_unit.toLowerCase().includes(q)
    );
    renderVotersTable(filtered);
  });

  function openVoterModal(voterId) {
    const form = document.getElementById("form-voter");
    form.reset();
    document.getElementById("voter-id").value = "";

    if (voterId) {
      const v = cachedVoters.find((x) => x.id === voterId);
      if (!v) return;
      document.getElementById("modal-voter-title").textContent = "Edit Anggota Pemilih";
      document.getElementById("voter-id").value = v.id;
      document.getElementById("voter-fullname").value = v.full_name;
      document.getElementById("voter-class").value = v.class_or_unit;
      document.getElementById("voter-eligible").checked = v.is_eligible;
    } else {
      document.getElementById("modal-voter-title").textContent = "Tambah Anggota Pemilih";
      document.getElementById("voter-eligible").checked = true;
    }

    document.getElementById("modal-voter").classList.remove("hidden");
  }

  document.getElementById("btn-open-add-voter").addEventListener("click", () => openVoterModal(null));

  document.getElementById("form-voter").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("voter-id").value;
    const fullName = document.getElementById("voter-fullname").value.trim();
    const className = document.getElementById("voter-class").value.trim().toUpperCase();
    const isEligible = document.getElementById("voter-eligible").checked;

    try {
      if (id) {
        const { error } = await supabase
          .from("voters")
          .update({
            full_name: fullName,
            class_or_unit: className,
            is_eligible: isEligible,
            updated_at: new Date().toISOString()
          })
          .eq("id", id);
        if (error) throw error;
        await logAudit("UPDATE_VOTER", "voters", id, { full_name: fullName, class_or_unit: className });
      } else {
        const { data: ins, error } = await supabase
          .from("voters")
          .insert({
            full_name: fullName,
            class_or_unit: className,
            is_eligible: isEligible
          })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit("CREATE_VOTER", "voters", ins.id, { full_name: fullName, class_or_unit: className });
      }

      document.getElementById("modal-voter").classList.add("hidden");
      await loadVoters();
      await loadOverviewAndTally();
      notify("success", "Data pemilih berhasil disimpan.");
    } catch (err) {
      notify("error", "Gagal menyimpan data pemilih (pastikan tidak ada duplikat Nama dan Kelas yang sama).");
    }
  });

  // Impor CSV
  document.getElementById("btn-open-import-csv").addEventListener("click", () => {
    document.getElementById("csv-file-input").value = "";
    document.getElementById("modal-import-csv").classList.remove("hidden");
  });

  document.getElementById("btn-process-csv").addEventListener("click", async () => {
    const fileInput = document.getElementById("csv-file-input");
    if (!fileInput.files || !fileInput.files[0]) {
      alert("Pilih file CSV terlebih dahulu.");
      return;
    }

    const text = await fileInput.files[0].text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rowsToInsert = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[;,]/).map((p) => p.replace(/^"|"$/g, "").trim());
      if (parts.length < 2) continue;
      // Lewati baris header
      if (i === 0 && parts[0].toLowerCase().includes("nama")) continue;

      rowsToInsert.push({
        full_name: parts[0],
        class_or_unit: parts[1].toUpperCase(),
        is_eligible: true
      });
    }

    if (rowsToInsert.length === 0) {
      alert("Tidak ditemukan baris data yang valid pada file CSV.");
      return;
    }

    try {
      const { error } = await supabase.from("voters").insert(rowsToInsert);
      if (error) throw error;

      await logAudit("IMPORT_VOTERS_CSV", "voters", null, { imported_count: rowsToInsert.length });
      document.getElementById("modal-import-csv").classList.add("hidden");
      await loadVoters();
      await loadOverviewAndTally();
      notify("success", `Berhasil mengimpor ${rowsToInsert.length} anggota ke Daftar Pemilih Tetap.`);
    } catch (err) {
      notify("error", "Sebagian atau seluruh data gagal diimpor karena duplikasi Nama dan Kelas.");
    }
  });

  // ==========================================================================
  // 7. TOKEN PEMILIHAN BERSAMA + KONTROL KEDALUWARSA + QR CODE
  // ==========================================================================
  async function loadActiveTokenMetadata() {
    const box = document.getElementById("active-token-metadata-box");
    const { data, error } = await supabase
      .from("voting_tokens")
      .select("id, label, expires_at, is_revoked, usage_count, issued_at")
      .eq("is_revoked", false)
      .order("issued_at", { ascending: false })
      .limit(1);

    if (error) {
      box.textContent = "Gagal memuat metadata token.";
      return;
    }

    if (!data || data.length === 0) {
      box.innerHTML = '<span class="badge badge-closed">Belum Ada Token Aktif</span>';
      return;
    }

    const tok = data[0];
    const isExpired = new Date(tok.expires_at) <= new Date();

    box.innerHTML = `
      <div style="display:grid; gap:0.45rem; padding:0.875rem; background:var(--color-soft-gray); border-radius:var(--radius-md);">
        <div><strong>Keterangan:</strong> ${Utils.escapeHTML(tok.label)}</div>
        <div>
          <strong>Status:</strong>
          ${
            isExpired
              ? '<span class="badge badge-closed">Sudah Kedaluwarsa</span>'
              : '<span class="badge badge-open">Aktif Berlaku</span>'
          }
        </div>
        <div><strong>Kedaluwarsa Pada:</strong> ${Utils.formatDateTime(tok.expires_at)}</div>
        <div><strong>Jumlah Pemakaian:</strong> ${tok.usage_count} suara masuk</div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
          <button type="button" id="btn-edit-token-expiry" class="btn btn-outline btn-sm" data-id="${tok.id}" data-exp="${tok.expires_at}">
            Ubah Waktu Kedaluwarsa
          </button>
          <button type="button" id="btn-revoke-token" class="btn btn-danger-outline btn-sm" data-id="${tok.id}">
            Cabut Token Sekarang
          </button>
        </div>
      </div>
    `;

    document.getElementById("btn-edit-token-expiry").addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-id");
      const exp = e.currentTarget.getAttribute("data-exp");
      document.getElementById("expiry-token-id").value = id;
      document.getElementById("new-expiry-datetime").value = toLocalDatetimeInput(exp);
      document.getElementById("modal-token-expiry").classList.remove("hidden");
    });

    document.getElementById("btn-revoke-token").addEventListener("click", async (e) => {
      const id = e.currentTarget.getAttribute("data-id");
      if (!window.confirm("Cabut token aktif ini sekarang? Pemilih tidak akan bisa memakai kode ini lagi.")) return;
      try {
        const { error: revErr } = await supabase.rpc("admin_revoke_active_token", { p_token_id: id });
        if (revErr) throw revErr;

        document.getElementById("qr-print-area").classList.add("hidden");
        document.getElementById("qr-print-actions").classList.add("hidden");
        document.getElementById("qr-empty-state").classList.remove("hidden");
        await loadActiveTokenMetadata();
        await loadAuditLogs();
        notify("success", "Token pemilihan berhasil dicabut.");
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });
  }

  document.getElementById("form-generate-token").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("token-label-input").value.trim();
    const minutes = parseInt(document.getElementById("token-duration-select").value, 10);

    try {
      const { data, error } = await supabase.rpc("admin_generate_shared_token", {
        p_expires_in_minutes: minutes,
        p_label: label
      });
      if (error) throw error;

      // Render QR Code murni dari raw_token (Zero-URL Exposure)
      const qrCanvasEl = document.getElementById("qrcode-canvas");
      qrCanvasEl.innerHTML = "";
      new window.QRCode(qrCanvasEl, {
        text: data.raw_token,
        width: 210,
        height: 210,
        colorDark: "#171717",
        colorLight: "#FFFFFF",
        correctLevel: window.QRCode.CorrectLevel.H
      });

      document.getElementById("qr-raw-token-text").textContent = data.raw_token;
      document.getElementById("qr-expiry-text").textContent =
        `Berlaku hingga: ${Utils.formatDateTime(data.expires_at)}`;

      document.getElementById("qr-empty-state").classList.add("hidden");
      document.getElementById("qr-print-area").classList.remove("hidden");
      document.getElementById("qr-print-actions").classList.remove("hidden");

      await loadActiveTokenMetadata();
      await loadAuditLogs();
      notify("success", "Token bersama & QR Code baru berhasil dibuat.");
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  });

  document.getElementById("form-update-expiry").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tokenId = document.getElementById("expiry-token-id").value;
    const localVal = document.getElementById("new-expiry-datetime").value;
    if (!localVal) return;

    try {
      const isoVal = new Date(localVal).toISOString();
      const { error } = await supabase.rpc("admin_update_token_expiry", {
        p_token_id: tokenId,
        p_new_expires_at: isoVal
      });
      if (error) throw error;

      document.getElementById("modal-token-expiry").classList.add("hidden");
      document.getElementById("qr-expiry-text").textContent = `Berlaku hingga: ${Utils.formatDateTime(isoVal)}`;
      await loadActiveTokenMetadata();
      await loadAuditLogs();
      notify("success", "Waktu kedaluwarsa token berhasil diperbarui.");
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  });

  document.getElementById("btn-print-qr").addEventListener("click", () => {
    window.print();
  });

  // ==========================================================================
  // 8. KONTROL TAHAPAN & JADWAL PEMILIHAN
  // ==========================================================================
  document.querySelectorAll(".js-status-action").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetStatus = btn.getAttribute("data-target-status");
      const confirmMsg =
        targetStatus === "RESULTS_PUBLISHED"
          ? "Apakah Anda yakin mengesahkan dan memublikasikan hasil resmi pemilihan ke halaman publik?"
          : `Ubah status pemilihan menjadi ${targetStatus}?`;

      if (!window.confirm(confirmMsg)) return;

      try {
        const { error } = await supabase.rpc("admin_set_election_status", {
          p_new_status: targetStatus
        });
        if (error) throw error;

        await loadSettingsAndStatus();
        await loadAuditLogs();
        notify("success", `Status pemilihan berhasil diubah menjadi ${targetStatus}.`);
      } catch (err) {
        notify("error", SbService.mapFriendlyError(err));
      }
    });
  });

  document.getElementById("form-election-schedule").addEventListener("submit", async (e) => {
    e.preventDefault();
    const startVal = document.getElementById("input-start-at").value;
    const endVal = document.getElementById("input-end-at").value;

    try {
      const { error } = await supabase.rpc("admin_set_election_status", {
        p_new_status: currentSettings.status,
        p_start_at: startVal ? new Date(startVal).toISOString() : null,
        p_end_at: endVal ? new Date(endVal).toISOString() : null
      });
      if (error) throw error;

      await loadSettingsAndStatus();
      await loadAuditLogs();
      notify("success", "Jadwal mulai dan berakhir pemilihan berhasil disimpan.");
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  });

  // ==========================================================================
  // 9. LAPORAN CSV & BERITA ACARA PDF
  // ==========================================================================
  document.getElementById("btn-download-csv").addEventListener("click", async () => {
    await loadOverviewAndTally();
    const rows = [
      ["LAPORAN REKAPITULASI HASIL PEMILIHAN KETUA PASKIBRA MAN 4 BANJAR"],
      ["Periode", currentSettings.period_label || "2026/2027"],
      ["Waktu Cetak", new Date().toLocaleString("id-ID")],
      ["Total Pemilih Tetap", latestTally.total_eligible_voters],
      ["Total Suara Masuk", latestTally.total_voted],
      ["Partisipasi (%)", `${latestTally.participation_rate}%`],
      [],
      ["Nomor Urut", "Nama Calon Ketua", "Jumlah Suara", "Persentase (%)"]
    ];

    (latestTally.chairperson || []).forEach((c) => {
      rows.push([c.candidate_number, `"${c.full_name}"`, c.votes, c.percentage]);
    });

    const csvContent = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Rekap_PASMANTAB_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    await logAudit("EXPORT_REPORT_CSV", "reports", null, {});
    await loadAuditLogs();
  });

  document.getElementById("btn-download-pdf").addEventListener("click", async () => {
    await loadOverviewAndTally();
    if (!window.jspdf || !window.jspdf.jsPDF) {
      notify("error", "Library PDF belum siap. Periksa koneksi internet Anda.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const generatedAt = new Date().toLocaleString("id-ID", {
      dateStyle: "full",
      timeStyle: "medium"
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("BERITA ACARA REKAPITULASI HASIL PEMILIHAN", 105, 20, { align: "center" });

    doc.setFontSize(12);
    doc.text(
      `KETUA ${currentSettings.organization_name || "PASKIBRA MAN 4 BANJAR"}`,
      105,
      27,
      { align: "center" }
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Periode Kepengurusan: ${currentSettings.period_label || "2026/2027"}`, 105, 34, {
      align: "center"
    });
    doc.line(20, 39, 190, 39);

    doc.text(`Waktu Pembuatan Dokumen : ${generatedAt}`, 20, 48);
    doc.text(`Status Pemilihan        : ${latestTally.status}`, 20, 54);
    doc.text(`Total Pemilih Tetap     : ${latestTally.total_eligible_voters} anggota`, 20, 60);
    doc.text(
      `Total Suara Masuk       : ${latestTally.total_voted} suara (${latestTally.participation_rate}%)`,
      20,
      66
    );

    // Header Tabel Kandidat
    let y = 78;
    doc.setFillColor(127, 29, 45);
    doc.setTextColor(255, 255, 255);
    doc.rect(20, y, 170, 9, "F");
    doc.setFont("helvetica", "bold");
    doc.text("No. Urut", 24, y + 6);
    doc.text("Nama Calon Ketua", 50, y + 6);
    doc.text("Perolehan Suara", 135, y + 6);
    doc.text("Persentase", 168, y + 6);

    y += 9;
    doc.setTextColor(23, 23, 23);
    doc.setFont("helvetica", "normal");

    (latestTally.chairperson || []).forEach((c) => {
      doc.rect(20, y, 170, 9);
      doc.text(String(c.candidate_number).padStart(2, "0"), 28, y + 6);
      doc.text(String(c.full_name), 50, y + 6);
      doc.text(`${c.votes} suara`, 138, y + 6);
      doc.text(`${c.percentage}%`, 170, y + 6);
      y += 9;
    });

    y += 16;
    doc.text("Disahkan oleh Panitia Pemilihan PASMANTAB MAN 4 Banjar,", 20, y);
    y += 24;
    doc.text("__________________________", 20, y);
    doc.text("__________________________", 125, y);
    y += 6;
    doc.text("Ketua Panitia Pemilihan", 25, y);
    doc.text("Pembina Paskibra", 135, y);

    doc.save(`Berita_Acara_PASMANTAB_${Date.now()}.pdf`);

    await logAudit("EXPORT_REPORT_PDF", "reports", null, {});
    await loadAuditLogs();
  });

  // ==========================================================================
  // 10. AUDIT LOGS & SETTINGS
  // ==========================================================================
  async function loadAuditLogs() {
    const tbody = document.getElementById("audit-logs-body");
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, action, target_entity, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Gagal memuat log audit.</td></tr>';
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Belum ada catatan aktivitas.</td></tr>';
      return;
    }

    tbody.innerHTML = data
      .map(
        (log) => `
        <tr>
          <td style="white-space:nowrap;">${Utils.formatDateTime(log.created_at)}</td>
          <td><strong>${Utils.escapeHTML(log.action)}</strong></td>
          <td>${Utils.escapeHTML(log.target_entity || "-")}</td>
          <td style="font-family:var(--font-mono); font-size:0.78rem; color:var(--color-text-secondary);">
            ${Utils.escapeHTML(JSON.stringify(log.metadata || {}))}
          </td>
        </tr>
      `
      )
      .join("");
  }

  document.getElementById("btn-refresh-audit").addEventListener("click", async () => {
    await loadAuditLogs();
    notify("success", "Log audit berhasil diperbarui.");
  });

  document.getElementById("form-org-settings").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgName = document.getElementById("setting-org-name").value.trim();
    const periodLabel = document.getElementById("setting-period-label").value.trim();

    try {
      const { error } = await supabase
        .from("election_settings")
        .update({
          organization_name: orgName,
          period_label: periodLabel,
          updated_at: new Date().toISOString(),
          updated_by: currentAdmin.id
        })
        .eq("id", 1);

      if (error) throw error;

      await logAudit("UPDATE_ORG_SETTINGS", "election_settings", "1", {
        organization_name: orgName,
        period_label: periodLabel
      });
      await loadSettingsAndStatus();
      await loadAuditLogs();
      notify("success", "Pengaturan organisasi berhasil disimpan.");
    } catch (err) {
      notify("error", SbService.mapFriendlyError(err));
    }
  });

  document.addEventListener("DOMContentLoaded", initAdminDashboard);
})();
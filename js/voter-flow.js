/**
 * PASMANTAB e-VOTING 2026 — Voter Flow Controller
 * Alur 3 Tahap: Verifikasi (Nama + Kelas + Token) -> Pilih Ketua -> Konfirmasi -> Sukses
 */
(function () {
  const Utils = window.PasmantabUtils;
  const SbService = window.SupabaseService;
  const Engine = window.VotingEngine;

  const COMPLETED_FLAG_KEY = "pasmantab_vote_completed_flag";

  function resolveEffectiveStatus(settings) {
    if (!settings) return "SETUP";
    const now = new Date();
    const startAt = settings.start_at ? new Date(settings.start_at) : null;
    const endAt = settings.end_at ? new Date(settings.end_at) : null;

    if (settings.status === "OPEN") {
      if (startAt && now < startAt) return "SCHEDULED";
      if (endAt && now > endAt) return "CLOSED";
      return "OPEN";
    }
    return settings.status;
  }

  function normalizeTextSpaces(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function getInitials(fullName) {
    const parts = String(fullName || "K")
      .trim()
      .split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function renderCandidateCards(containerEl, candidates, selectedId, onSelect) {
    if (!candidates || candidates.length === 0) {
      containerEl.innerHTML =
        '<div class="alert alert-warning">Belum ada calon Ketua aktif yang terdaftar. Silakan hubungi panitia.</div>';
      return;
    }

    containerEl.innerHTML = candidates
      .map((cand) => {
        const isSelected = cand.id === selectedId;
        const numFormatted = String(cand.candidate_number).padStart(2, "0");
        const initials = getInitials(cand.full_name);
        const safeName = Utils.escapeHTML(cand.full_name);
        const safeVision = Utils.escapeHTML(cand.vision);
        const safeMission = Utils.escapeHTML(cand.mission);
        const safeProgram = cand.flagship_program
          ? Utils.escapeHTML(cand.flagship_program)
          : "";

        const photoHtml = cand.photo_url
          ? `<img src="${Utils.escapeHTML(cand.photo_url)}" alt="Foto ${safeName}" class="candidate-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
             <div class="candidate-avatar-fallback" style="display:none;">${initials}</div>`
          : `<div class="candidate-avatar-fallback">${initials}</div>`;

        return `
          <article class="candidate-card ${isSelected ? "selected" : ""}" data-candidate-id="${cand.id}">
            <div>
              <div class="candidate-header">
                <div class="candidate-photo-wrap">
                  <span class="candidate-number-badge">${numFormatted}</span>
                  ${photoHtml}
                </div>
                <div>
                  <div style="font-size: 0.75rem; font-weight: 700; color: var(--color-muted-gray);">
                    CALON KETUA NOMOR URUT ${numFormatted}
                  </div>
                  <h3 style="font-size: 1.15rem; margin-top: 0.15rem;">${safeName}</h3>
                </div>
              </div>

              <div class="candidate-section-title">Visi</div>
              <p class="candidate-text">${safeVision}</p>

              <div class="candidate-section-title">Misi</div>
              <p class="candidate-text">${safeMission}</p>

              ${
                safeProgram
                  ? `<div class="candidate-section-title">Program Unggulan</div>
                     <p class="candidate-text">${safeProgram}</p>`
                  : ""
              }
            </div>

            <div class="candidate-footer">
              <button
                type="button"
                class="btn ${isSelected ? "btn-burgundy" : "btn-outline"} btn-full js-select-candidate"
                data-id="${cand.id}"
                aria-pressed="${isSelected}"
              >
                ${isSelected ? "✓ KANDIDAT TERPILIH" : "PILIH KANDIDAT"}
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    containerEl.querySelectorAll(".js-select-candidate").forEach((btn) => {
      btn.addEventListener("click", () => {
        const chosenId = btn.getAttribute("data-id");
        onSelect(chosenId);
      });
    });
  }

  // ==========================================================================
  // PAGE 01 — LANDING PAGE (AUTO-SYNC REALTIME TANPA PERLU REFRESH)
  // ==========================================================================
  async function initLandingPage() {
    const badgeEl = document.getElementById("election-status-badge");
    const periodEl = document.getElementById("period-label");
    const scheduleInfoEl = document.getElementById("schedule-info");
    const startBtnEl = document.getElementById("btn-start-vote");
    const closedNoticeEl = document.getElementById("closed-notice");
    const publicResultsSection = document.getElementById("public-results-section");

    let lastRenderedSignature = "";
    let resultsLoaded = false;

    async function applyLandingSettings(supabase, settings) {
      if (!settings) return;

      const effectiveStatus = resolveEffectiveStatus(settings);
      const signature = [
        effectiveStatus,
        settings.period_label || "",
        settings.start_at || "",
        settings.end_at || ""
      ].join("|");

      // Lewati render ulang jika tidak ada perubahan status/jadwal
      if (signature === lastRenderedSignature) return;
      lastRenderedSignature = signature;

      Utils.hideAlert("setup-alert");

      if (periodEl && settings.period_label) {
        periodEl.textContent = `PERIODE KEPENGURUSAN ${settings.period_label}`;
      }

      if (scheduleInfoEl) {
        if (settings.start_at || settings.end_at) {
          const startText = settings.start_at
            ? Utils.formatDateTime(settings.start_at)
            : "Ditentukan panitia";
          const endText = settings.end_at
            ? Utils.formatDateTime(settings.end_at)
            : "Ditentukan panitia";
          scheduleInfoEl.innerHTML = `Jadwal Pemungutan Suara: <strong>${startText}</strong> s.d. <strong>${endText}</strong>`;
          scheduleInfoEl.classList.remove("hidden");
        } else {
          scheduleInfoEl.classList.add("hidden");
        }
      }

      if (effectiveStatus === "OPEN") {
        badgeEl.className = "badge badge-open";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Sedang Berlangsung</span>';
        startBtnEl.classList.remove("hidden");
        closedNoticeEl.classList.add("hidden");
      } else if (effectiveStatus === "SCHEDULED" || effectiveStatus === "SETUP") {
        badgeEl.className = "badge badge-scheduled";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Belum Dimulai</span>';
        startBtnEl.classList.add("hidden");
        closedNoticeEl.textContent =
          "Pemungutan suara belum dibuka oleh panitia. Halaman ini akan otomatis aktif begitu pemilihan dibuka.";
        closedNoticeEl.classList.remove("hidden");
      } else {
        badgeEl.className = "badge badge-closed";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Pemilihan Ditutup</span>';
        startBtnEl.classList.add("hidden");
        closedNoticeEl.textContent =
          effectiveStatus === "RESULTS_PUBLISHED"
            ? "Pemilihan telah selesai dan hasil resmi telah disahkan oleh panitia."
            : "Pemungutan suara telah ditutup. Rekapitulasi suara sedang diproses oleh panitia.";
        closedNoticeEl.classList.remove("hidden");
      }

      if (effectiveStatus === "RESULTS_PUBLISHED" && publicResultsSection && !resultsLoaded) {
        const { data: tally, error: tallyErr } = await supabase.rpc("get_election_tally");
        if (!tallyErr && tally) {
          resultsLoaded = true;
          renderPublicResults(publicResultsSection, tally);
        }
      } else if (effectiveStatus !== "RESULTS_PUBLISHED" && publicResultsSection) {
        resultsLoaded = false;
        publicResultsSection.classList.add("hidden");
      }
    }

    try {
      const supabase = SbService.getClient();

      async function fetchAndSync() {
        const { data: settings, error } = await supabase
          .from("election_settings")
          .select("*")
          .eq("id", 1)
          .single();

        if (error) throw error;
        await applyLandingSettings(supabase, settings);
      }

      // 1. Muat status pertama kali
      await fetchAndSync();

      // 2. Dengarkan perubahan instan via Supabase Realtime
      const statusChannel = supabase
        .channel("public-election-settings")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "election_settings",
            filter: "id=eq.1"
          },
          async (payload) => {
            if (payload && payload.new) {
              await applyLandingSettings(supabase, payload.new);
            }
          }
        )
        .subscribe();

      // 3. Cadangan pengecekan otomatis tiap 4 detik saat tab aktif
      const pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchAndSync().catch(() => {});
        }
      }, 4000);

      window.addEventListener("beforeunload", () => {
        clearInterval(pollTimer);
        supabase.removeChannel(statusChannel);
      });
    } catch (err) {
      badgeEl.className = "badge badge-closed";
      badgeEl.innerHTML = '<span class="badge-dot"></span><span>Gangguan Koneksi</span>';
      Utils.showAlert("setup-alert", "error", SbService.mapFriendlyError(err));
    }
  }
    try {
      const supabase = SbService.getClient();
      const { data: settings, error } = await supabase
        .from("election_settings")
        .select("*")
        .eq("id", 1)
        .single();

      if (error) throw error;

      if (periodEl && settings.period_label) {
        periodEl.textContent = `PERIODE KEPENGURUSAN ${settings.period_label}`;
      }

      if (scheduleInfoEl && (settings.start_at || settings.end_at)) {
        const startText = settings.start_at
          ? Utils.formatDateTime(settings.start_at)
          : "Ditentukan panitia";
        const endText = settings.end_at
          ? Utils.formatDateTime(settings.end_at)
          : "Ditentukan panitia";
        scheduleInfoEl.innerHTML = `Jadwal Pemungutan Suara: <strong>${startText}</strong> s.d. <strong>${endText}</strong>`;
        scheduleInfoEl.classList.remove("hidden");
      }

      const effectiveStatus = resolveEffectiveStatus(settings);

      if (effectiveStatus === "OPEN") {
        badgeEl.className = "badge badge-open";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Sedang Berlangsung</span>';
        startBtnEl.classList.remove("hidden");
      } else if (effectiveStatus === "SCHEDULED" || effectiveStatus === "SETUP") {
        badgeEl.className = "badge badge-scheduled";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Belum Dimulai</span>';
        closedNoticeEl.textContent =
          "Pemungutan suara belum dibuka oleh panitia. Silakan tunggu hingga jadwal pemilihan dimulai.";
        closedNoticeEl.classList.remove("hidden");
      } else {
        badgeEl.className = "badge badge-closed";
        badgeEl.innerHTML = '<span class="badge-dot"></span><span>Pemilihan Ditutup</span>';
        closedNoticeEl.textContent =
          effectiveStatus === "RESULTS_PUBLISHED"
            ? "Pemilihan telah selesai dan hasil resmi telah disahkan oleh panitia."
            : "Pemungutan suara telah ditutup. Rekapitulasi suara sedang diproses oleh panitia.";
        closedNoticeEl.classList.remove("hidden");
      }

      if (effectiveStatus === "RESULTS_PUBLISHED" && publicResultsSection) {
        const { data: tally, error: tallyErr } = await supabase.rpc("get_election_tally");
        if (!tallyErr && tally) {
          renderPublicResults(publicResultsSection, tally);
        }
      }
    } catch (err) {
      badgeEl.className = "badge badge-closed";
      badgeEl.innerHTML = '<span class="badge-dot"></span><span>Gangguan Koneksi</span>';
      Utils.showAlert("setup-alert", "error", SbService.mapFriendlyError(err));
    }
  }

  function renderPublicResults(sectionEl, tally) {
    const items = tally.chairperson || [];
    const listHtml =
      items.length === 0
        ? "<p class='text-muted'>Tidak ada data kandidat.</p>"
        : items
            .map(
              (item) => `
              <div style="padding: 0.875rem 0; border-bottom: 1px solid var(--color-border);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                  <div>
                    <span style="font-weight:700; color:var(--color-burgundy);">#${String(item.candidate_number).padStart(2, "0")}</span>
                    <strong style="margin-left:0.35rem;">${Utils.escapeHTML(item.full_name)}</strong>
                  </div>
                  <div style="text-align:right; font-size:0.875rem;">
                    <strong>${item.votes} suara</strong> (${item.percentage}%)
                  </div>
                </div>
                <div class="result-bar-track">
                  <div class="result-bar-fill" style="width:${Math.min(Number(item.percentage) || 0, 100)}%;"></div>
                </div>
              </div>
            `
            )
            .join("");

    sectionEl.innerHTML = `
      <div class="card mt-3">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
          <h2 style="font-size:1.2rem;">Hasil Resmi Pemilihan Ketua</h2>
          <span class="badge badge-open">Partisipasi: ${tally.total_voted}/${tally.total_eligible_voters} (${tally.participation_rate}%)</span>
        </div>
        ${listHtml}
      </div>
    `;
    sectionEl.classList.remove("hidden");
  }

  // ==========================================================================
  // PAGE 02 — VOTER VERIFICATION (NAMA LENGKAP + KELAS + TOKEN BERSAMA)
  // ==========================================================================
  async function initVerifyPage() {
    const form = document.getElementById("verify-form");
    const nameInput = document.getElementById("input-full-name");
    const classInput = document.getElementById("input-class-name");
    const tokenInput = document.getElementById("input-token-code");
    const submitBtn = document.getElementById("btn-verify-submit");
    const toggleScanBtn = document.getElementById("btn-toggle-scanner");
    const scannerWrapper = document.getElementById("qr-scanner-wrapper");

    // Cek langsung apakah perangkat ini sudah pernah digunakan untuk memilih
    if (Engine && Engine.isDeviceLockedLocally()) {
      Utils.showAlert(
        "verify-alert",
        "warning",
        "Perangkat ini sudah digunakan untuk memberikan suara pada pemilihan ini (1 Perangkat = 1 Suara)."
      );
      nameInput.disabled = true;
      classInput.disabled = true;
      tokenInput.disabled = true;
      submitBtn.disabled = true;
      if (toggleScanBtn) toggleScanBtn.disabled = true;
      return;
    }

    let html5QrInstance = null;
    let isScanning = false;

    try {
      const supabase = SbService.getClient();
      const { data: settings, error } = await supabase
        .from("election_settings")
        .select("*")
        .eq("id", 1)
        .single();
      if (error) throw error;

      const status = resolveEffectiveStatus(settings);
      if (status !== "OPEN") {
        Utils.showAlert(
          "verify-alert",
          "warning",
          "Pemungutan suara saat ini belum dibuka atau sudah ditutup. Anda akan diarahkan ke halaman utama."
        );
        submitBtn.disabled = true;
        toggleScanBtn.disabled = true;
        setTimeout(() => {
          window.location.href = "../index.html";
        }, 2500);
        return;
      }
    } catch (err) {
      Utils.showAlert("verify-alert", "error", SbService.mapFriendlyError(err));
    }

    async function stopScanner() {
      if (html5QrInstance && isScanning) {
        try {
          await html5QrInstance.stop();
          await html5QrInstance.clear();
        } catch (_) {}
      }
      isScanning = false;
      scannerWrapper.classList.add("hidden");
      toggleScanBtn.textContent = "Pindai QR Code dengan Kamera";
    }

    window.addEventListener("beforeunload", stopScanner);

    if (toggleScanBtn) {
      toggleScanBtn.addEventListener("click", async () => {
        Utils.hideAlert("verify-alert");

        if (isScanning) {
          await stopScanner();
          return;
        }

        if (!window.Html5Qrcode) {
          Utils.showAlert(
            "verify-alert",
            "warning",
            "Komponen pemindai kamera belum siap. Silakan ketik kode token secara manual."
          );
          return;
        }

        scannerWrapper.classList.remove("hidden");
        toggleScanBtn.textContent = "Tutup Kamera Pemindai";

        try {
          html5QrInstance = new window.Html5Qrcode("qr-reader");
          await html5QrInstance.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            async (decodedText) => {
              const cleaned = Utils.normalizeCode(decodedText);
              if (cleaned.startsWith("HTTP://") || cleaned.startsWith("HTTPS://")) {
                Utils.showAlert(
                  "verify-alert",
                  "error",
                  "Format QR Code tidak valid. Pastikan Anda memindai QR Code Token resmi PASMANTAB."
                );
                await stopScanner();
                return;
              }
              tokenInput.value = cleaned;
              await stopScanner();
              Utils.showAlert(
                "verify-alert",
                "success",
                "QR Code token berhasil dipindai. Pastikan Nama Lengkap dan Kelas sudah terisi, lalu tekan Verifikasi."
              );
            },
            () => {}
          );
          isScanning = true;
        } catch (_) {
          await stopScanner();
          Utils.showAlert(
            "verify-alert",
            "warning",
            "Kamera tidak dapat diakses atau izin kamera ditolak. Silakan ketik kode token secara manual pada kolom di bawah."
          );
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      Utils.hideAlert("verify-alert");

      const fullName = normalizeTextSpaces(nameInput.value);
      const className = normalizeTextSpaces(classInput.value).toUpperCase();
      const rawToken = Utils.normalizeCode(tokenInput.value);

      if (fullName.length < 2) {
        Utils.showAlert("verify-alert", "error", "Masukkan Nama Lengkap Anda sesuai daftar anggota.");
        nameInput.focus();
        return;
      }

      if (className.length < 2) {
        Utils.showAlert("verify-alert", "error", "Masukkan Kelas Anda (contoh: XI IPA 2).");
        classInput.focus();
        return;
      }

      if (rawToken.length < 6) {
        Utils.showAlert("verify-alert", "error", "Masukkan Kode Token Pemilihan dari panitia.");
        tokenInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Memverifikasi Hak Suara...";

      try {
        await stopScanner();
        const data = await Engine.verifyAccess(fullName, className, rawToken);

        Utils.clearVoterDraft();
        sessionStorage.removeItem(COMPLETED_FLAG_KEY);
        Utils.saveVoterDraft({
          verified: true,
          voterName: data.full_name,
          voterClass: data.class_or_unit,
          rawToken: rawToken,
          chairperson: null
        });

        window.location.href = "./chairperson.html";
      } catch (err) {
        Utils.showAlert("verify-alert", "error", SbService.mapFriendlyError(err));
        submitBtn.disabled = false;
        submitBtn.textContent = "VERIFIKASI & MASUK BILIK SUARA";
      }
    });
  }

  // ==========================================================================
  // PAGE 03 — CHOOSE CHAIRPERSON
  // ==========================================================================
  async function initChairpersonPage() {
    const draft = Utils.getVoterDraft();
    if (!draft || !draft.verified || !draft.voterName || !draft.voterClass || !draft.rawToken) {
      window.location.replace("./verify.html");
      return;
    }

    const voterBannerEl = document.getElementById("voter-identity-banner");
    const gridEl = document.getElementById("candidates-container");
    const nextBtn = document.getElementById("btn-next-review");

    if (voterBannerEl) {
      voterBannerEl.textContent = `Pemilih Terverifikasi: ${draft.voterName} — Kelas ${draft.voterClass}`;
    }

    let candidates = [];
    let selectedId = draft.chairperson ? draft.chairperson.id : null;

    function updateNextButtonState() {
      nextBtn.disabled = !selectedId;
    }

    try {
      const supabase = SbService.getClient();
      const { data, error } = await supabase
        .from("candidates")
        .select("*")
        .eq("position", "CHAIRPERSON")
        .eq("is_active", true)
        .order("candidate_number", { ascending: true });

      if (error) throw error;
      candidates = data || [];

      const handleSelect = (chosenId) => {
        selectedId = chosenId;
        const chosenObj = candidates.find((c) => c.id === chosenId) || null;
        Utils.saveVoterDraft({ chairperson: chosenObj });
        renderCandidateCards(gridEl, candidates, selectedId, handleSelect);
        updateNextButtonState();
      };

      renderCandidateCards(gridEl, candidates, selectedId, handleSelect);
      updateNextButtonState();
    } catch (err) {
      Utils.showAlert("ballot-alert", "error", SbService.mapFriendlyError(err));
    }

    nextBtn.addEventListener("click", () => {
      if (!selectedId) return;
      window.location.href = "./review.html";
    });
  }

  // ==========================================================================
  // PAGE 04 — VOTE REVIEW & ATOMIC SUBMISSION
  // ==========================================================================
  function initReviewPage() {
    const draft = Utils.getVoterDraft();
    if (!draft || !draft.verified || !draft.chairperson) {
      window.location.replace("./verify.html");
      return;
    }

    const chairSummaryEl = document.getElementById("review-chairperson-box");
    const confirmCheckbox = document.getElementById("checkbox-final-consent");
    const submitBtn = document.getElementById("btn-submit-ballot");

    const candidate = draft.chairperson;
    const numFormatted = String(candidate.candidate_number).padStart(2, "0");
    const initials = getInitials(candidate.full_name);
    const safeName = Utils.escapeHTML(candidate.full_name);

    const photoHtml = candidate.photo_url
      ? `<img src="${Utils.escapeHTML(candidate.photo_url)}" alt="Foto ${safeName}" class="candidate-photo" style="width:60px;height:60px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="candidate-avatar-fallback" style="display:none;width:60px;height:60px;font-size:1.15rem;">${initials}</div>`
      : `<div class="candidate-avatar-fallback" style="width:60px;height:60px;font-size:1.15rem;">${initials}</div>`;

    chairSummaryEl.innerHTML = `
      <div class="review-choice-meta">
        ${photoHtml}
        <div>
          <span class="badge badge-neutral" style="margin-bottom:0.25rem;">Nomor Urut ${numFormatted}</span>
          <div style="font-family:var(--font-heading); font-weight:700; font-size:1.1rem;">${safeName}</div>
        </div>
      </div>
      <a href="./chairperson.html" class="btn btn-outline" style="min-height:40px; padding:0.45rem 0.9rem; font-size:0.8125rem;">
        Ubah
      </a>
    `;

    confirmCheckbox.addEventListener("change", () => {
      submitBtn.disabled = !confirmCheckbox.checked;
    });

    submitBtn.addEventListener("click", async () => {
      if (!confirmCheckbox.checked) return;

      submitBtn.disabled = true;
      confirmCheckbox.disabled = true;
      submitBtn.textContent = "Menyimpan Surat Suara...";
      Utils.hideAlert("review-alert");

      try {
        await Engine.submitBallotAtomic({
          voterName: draft.voterName,
          voterClass: draft.voterClass,
          rawToken: draft.rawToken,
          chairpersonId: draft.chairperson.id
        });

        Utils.clearVoterDraft();
        sessionStorage.setItem(COMPLETED_FLAG_KEY, "true");

        window.location.replace("./success.html");
      } catch (err) {
        if (String(err && err.message) === "SUBMISSION_IN_PROGRESS") return;
        confirmCheckbox.disabled = false;
        submitBtn.disabled = !confirmCheckbox.checked;
        submitBtn.textContent = "KONFIRMASI DAN KIRIM SUARA";
        Utils.showAlert("review-alert", "error", SbService.mapFriendlyError(err));
      }
    });
  }

  // ==========================================================================
  // PAGE 05 — SUCCESS PAGE
  // ==========================================================================
  function initSuccessPage() {
    Utils.clearVoterDraft();
    const isCompleted = sessionStorage.getItem(COMPLETED_FLAG_KEY) === "true";
    if (!isCompleted) {
      window.location.replace("../index.html");
      return;
    }

    const homeBtn = document.getElementById("btn-back-home");
    if (homeBtn) {
      homeBtn.addEventListener("click", () => {
        sessionStorage.removeItem(COMPLETED_FLAG_KEY);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.getAttribute("data-page");
    if (page === "landing") initLandingPage();
    else if (page === "verify") initVerifyPage();
    else if (page === "chairperson") initChairpersonPage();
    else if (page === "review") initReviewPage();
    else if (page === "success") initSuccessPage();
  });
})();

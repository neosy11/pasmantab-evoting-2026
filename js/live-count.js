/**
 * PASMANTAB e-VOTING 2026 — Projector Virtual Ballot Reveal Controller
 */
(function () {
  const Utils = window.PasmantabUtils;
  const SbService = window.SupabaseService;

  let candidates = [];
  let ballotDeck = [];
  let currentCounts = {};
  let currentIndex = 0;
  let isRunning = false;
  let isPaused = false;
  let soundEnabled = true;
  let revealTimer = null;
  let audioCtx = null;

  const startBtn = document.getElementById("btn-start-reveal");
  const pauseBtn = document.getElementById("btn-pause-reveal");
  const resetBtn = document.getElementById("btn-reset-reveal");
  const skipBtn = document.getElementById("btn-skip-reveal");
  const speedSelect = document.getElementById("select-reveal-speed");
  const soundBtn = document.getElementById("btn-toggle-sound");
  const fullscreenBtn = document.getElementById("btn-fullscreen");

  const ballotBox = document.getElementById("virtual-ballot-box");
  const ballotMeta = document.getElementById("ballot-meta");
  const ballotHeadline = document.getElementById("ballot-headline");
  const revealedCountEl = document.getElementById("revealed-count");
  const totalBallotsEl = document.getElementById("total-ballots-count");
  const participationPill = document.getElementById("participation-pill");
  const gridEl = document.getElementById("projector-candidates-grid");

  // Efek suara lonceng digital menggunakan Web Audio API bawaan browser
  function playTone(freq, duration, type = "sine", volume = 0.12) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function playBallotChime() {
    playTone(660, 0.14, "triangle", 0.1);
  }

  function playWinnerFanfare() {
    playTone(523.25, 0.25, "triangle", 0.14);
    setTimeout(() => playTone(659.25, 0.25, "triangle", 0.14), 140);
    setTimeout(() => playTone(783.99, 0.3, "triangle", 0.15), 280);
    setTimeout(() => playTone(1046.5, 0.65, "triangle", 0.18), 430);
  }

  // Fisher-Yates Shuffle agar urutan pembacaan surat suara teracak adil & menegangkan
  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getInitials(fullName) {
    const parts = String(fullName || "K").trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function renderInitialCards() {
    gridEl.innerHTML = candidates
      .map((cand) => {
        const num = String(cand.candidate_number).padStart(2, "0");
        const initials = getInitials(cand.full_name);
        const safeName = Utils.escapeHTML(cand.full_name);

        const mediaHtml = cand.photo_url
          ? `<img src="${Utils.escapeHTML(cand.photo_url)}" alt="${safeName}" class="proj-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
             <div class="proj-avatar" style="display:none;">${initials}</div>`
          : `<div class="proj-avatar">${initials}</div>`;

        return `
          <article id="proj-card-${cand.id}" class="proj-card">
            <div id="winner-slot-${cand.id}"></div>
            <div class="proj-cand-top">
              ${mediaHtml}
              <div>
                <span class="proj-num-tag">NOMOR URUT ${num}</span>
                <h2 class="proj-cand-name">${safeName}</h2>
              </div>
            </div>

            <div class="proj-score-row">
              <div>
                <span id="proj-count-${cand.id}" class="proj-vote-count">0</span>
                <span class="proj-vote-unit">suara</span>
              </div>
              <div id="proj-pct-${cand.id}" class="proj-vote-pct">0.0%</div>
            </div>

            <div class="proj-bar-track">
              <div id="proj-bar-${cand.id}" class="proj-bar-fill" style="width:0%;"></div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function updateScoreboardUI(highlightCandidateId = null) {
    const total = Math.max(ballotDeck.length, 1);

    candidates.forEach((cand) => {
      const count = currentCounts[cand.id] || 0;
      const pct = ballotDeck.length > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

      const countEl = document.getElementById(`proj-count-${cand.id}`);
      const pctEl = document.getElementById(`proj-pct-${cand.id}`);
      const barEl = document.getElementById(`proj-bar-${cand.id}`);
      const cardEl = document.getElementById(`proj-card-${cand.id}`);

      if (countEl) countEl.textContent = String(count);
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (barEl) barEl.style.width = `${Math.min(Number(pct), 100)}%`;

      if (cardEl) {
        if (cand.id === highlightCandidateId) {
          cardEl.classList.remove("flash-vote");
          void cardEl.offsetWidth;
          cardEl.classList.add("flash-vote");
        } else {
          cardEl.classList.remove("flash-vote");
        }
      }
    });

    revealedCountEl.textContent = String(currentIndex);
  }

  function finishReveal() {
    isRunning = false;
    isPaused = false;
    clearTimeout(revealTimer);

    pauseBtn.classList.add("hidden");
    skipBtn.classList.add("hidden");
    resetBtn.classList.remove("hidden");

    // Cari peraih suara terbanyak
    let maxVotes = -1;
    candidates.forEach((c) => {
      const v = currentCounts[c.id] || 0;
      if (v > maxVotes) maxVotes = v;
    });

    const winners = candidates.filter((c) => (currentCounts[c.id] || 0) === maxVotes && maxVotes > 0);

    candidates.forEach((c) => {
      const cardEl = document.getElementById(`proj-card-${c.id}`);
      const slotEl = document.getElementById(`winner-slot-${c.id}`);
      if (!cardEl || !slotEl) return;

      cardEl.classList.remove("flash-vote");
      if (winners.some((w) => w.id === c.id)) {
        cardEl.classList.add("winner-card");
        slotEl.innerHTML = `<div class="winner-ribbon">&#9733; PERAIH SUARA TERBANYAK</div>`;
      }
    });

    if (winners.length === 1) {
      const w = winners[0];
      const num = String(w.candidate_number).padStart(2, "0");
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI • HASIL FINAL";
      ballotHeadline.textContent = `Suara Terbanyak: Nomor Urut ${num} — ${w.full_name} (${maxVotes} Suara)`;
    } else if (winners.length > 1) {
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI • HASIL IMBANG";
      ballotHeadline.textContent = `Terdapat perolehan suara imbang (${maxVotes} suara). Keputusan mengikuti tata tertib musyawarah.`;
    } else {
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI";
      ballotHeadline.textContent = "Belum ada surat suara yang masuk.";
    }

    playWinnerFanfare();
  }

  function stepNextBallot() {
    if (!isRunning || isPaused) return;

    if (currentIndex >= ballotDeck.length) {
      finishReveal();
      return;
    }

    const ballot = ballotDeck[currentIndex];
    currentIndex += 1;
    currentCounts[ballot.id] = (currentCounts[ballot.id] || 0) + 1;

    const numFormatted = String(ballot.candidate_number).padStart(2, "0");
    ballotMeta.textContent = `SURAT SUARA KE-${currentIndex} DARI ${ballotDeck.length} • SAH`;
    ballotHeadline.textContent = `NOMOR URUT ${numFormatted} — ${ballot.full_name}`;

    ballotBox.classList.remove("pop");
    void ballotBox.offsetWidth;
    ballotBox.classList.add("pop");

    updateScoreboardUI(ballot.id);
    playBallotChime();

    if (currentIndex >= ballotDeck.length) {
      revealTimer = setTimeout(finishReveal, 650);
    } else {
      const delay = Number(speedSelect.value) || 600;
      revealTimer = setTimeout(stepNextBallot, delay);
    }
  }

  function resetAllToZero() {
    isRunning = false;
    isPaused = false;
    clearTimeout(revealTimer);
    currentIndex = 0;
    currentCounts = {};
    candidates.forEach((c) => {
      currentCounts[c.id] = 0;
      const cardEl = document.getElementById(`proj-card-${c.id}`);
      const slotEl = document.getElementById(`winner-slot-${c.id}`);
      if (cardEl) cardEl.classList.remove("winner-card", "flash-vote");
      if (slotEl) slotEl.innerHTML = "";
    });

    ballotDeck = shuffleArray(ballotDeck);
    updateScoreboardUI(null);

    ballotMeta.textContent = "KOTAK SUARA TERSEGEL • SIAP DIBACAKAN";
    ballotHeadline.textContent = 'Tekan tombol "Mulai Pembacaan Suara" untuk memulai';

    startBtn.disabled = ballotDeck.length === 0;
    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    pauseBtn.textContent = "Jeda (Pause)";
    resetBtn.classList.add("hidden");
    skipBtn.classList.add("hidden");
  }

  // Event Listeners Kontrol Operator
  startBtn.addEventListener("click", () => {
    if (ballotDeck.length === 0) return;
    isRunning = true;
    isPaused = false;
    startBtn.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
    resetBtn.classList.remove("hidden");
    skipBtn.classList.remove("hidden");
    stepNextBallot();
  });

  pauseBtn.addEventListener("click", () => {
    if (!isRunning) return;
    isPaused = !isPaused;
    if (isPaused) {
      clearTimeout(revealTimer);
      pauseBtn.textContent = "Lanjutkan";
      ballotMeta.textContent = `DIJEDA PADA SURAT SUARA KE-${currentIndex} DARI ${ballotDeck.length}`;
    } else {
      pauseBtn.textContent = "Jeda (Pause)";
      stepNextBallot();
    }
  });

  resetBtn.addEventListener("click", () => {
    resetAllToZero();
  });

  skipBtn.addEventListener("click", () => {
    clearTimeout(revealTimer);
    while (currentIndex < ballotDeck.length) {
      const b = ballotDeck[currentIndex];
      currentIndex += 1;
      currentCounts[b.id] = (currentCounts[b.id] || 0) + 1;
    }
    updateScoreboardUI(null);
    finishReveal();
  });

  soundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? "Suara: Aktif" : "Suara: Hening";
    if (soundEnabled) playBallotChime();
  });

  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      fullscreenBtn.textContent = "Keluar Layar Penuh";
    } else {
      document.exitFullscreen().catch(() => {});
      fullscreenBtn.textContent = "Layar Penuh";
    }
  });

  // Inisialisasi & Validasi Hak Akses Panitia
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const supabase = SbService.getClient();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData || !sessionData.session) {
        window.location.replace("./login.html");
        return;
      }

      const { data: adminProfile, error: adminErr } = await supabase
        .from("admin_users")
        .select("id, is_active")
        .eq("id", sessionData.session.user.id)
        .eq("is_active", true)
        .single();

      if (adminErr || !adminProfile) {
        window.location.replace("./login.html");
        return;
      }

      const { data: settings } = await supabase
        .from("election_settings")
        .select("*")
        .eq("id", 1)
        .single();

      if (settings && settings.status === "OPEN") {
        Utils.showAlert(
          "proj-alert",
          "warning",
          "Perhatian: Status pemilihan masih OPEN. Tutup pemilihan (CLOSED) terlebih dahulu di menu Election Control agar tidak ada suara susulan saat pembacaan dimulai."
        );
      }

      const { data: tally, error: tallyErr } = await supabase.rpc("get_election_tally");
      if (tallyErr) throw tallyErr;

      candidates = tally.chairperson || [];
      ballotDeck = [];

      candidates.forEach((cand) => {
        const votes = Number(cand.votes) || 0;
        for (let i = 0; i < votes; i++) {
          ballotDeck.push({
            id: cand.id,
            candidate_number: cand.candidate_number,
            full_name: cand.full_name
          });
        }
      });

      totalBallotsEl.textContent = String(ballotDeck.length);
      participationPill.textContent = `Total Partisipasi: ${tally.total_voted} Anggota Hadir`;

      renderInitialCards();
      resetAllToZero();
    } catch (err) {
      Utils.showAlert("proj-alert", "error", SbService.mapFriendlyError(err));
    }
  });
})();

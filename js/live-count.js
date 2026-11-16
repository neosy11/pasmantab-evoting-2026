/**
 * PASMANTAB e-VOTING 2026 — Projector Virtual Ballot Reveal & Grand Ceremony FX
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
  let ceremonyDelayTimer = null;
  let suspenseTimers = [];
  let audioCtx = null;
  let fxAnimId = null;

  let orgNameLabel = "PASKIBRA MAN 4 BANJAR";
  let periodLabel = "2027";
  let lastCrownedWinner = null;
  let lastCrownedVotes = 0;

  const startBtn = document.getElementById("btn-start-reveal");
  const pauseBtn = document.getElementById("btn-pause-reveal");
  const resetBtn = document.getElementById("btn-reset-reveal");
  const skipBtn = document.getElementById("btn-skip-reveal");
  const showCeremonyBtn = document.getElementById("btn-show-ceremony");
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

  const ceremonyOverlay = document.getElementById("winner-ceremony-overlay");
  const ceremonyFlash = document.getElementById("ceremony-flash");
  const shockwave1 = document.getElementById("shockwave-1");
  const shockwave2 = document.getElementById("shockwave-2");
  const suspenseStage = document.getElementById("suspense-stage");
  const suspenseKicker = document.getElementById("suspense-kicker");
  const rouletteDigits = document.getElementById("roulette-digits");
  const ceremonyCard = document.getElementById("ceremony-card");
  const fxCanvas = document.getElementById("fx-canvas");
  const closeCeremonyBtn = document.getElementById("btn-close-ceremony");
  const replayConfettiBtn = document.getElementById("btn-replay-confetti");

  // ==========================================================================
  // 1. WEB AUDIO SYNTHESIZER (LONCENG, DRUMROLL TEGANG, BASS BOOM & FANFARE)
  // ==========================================================================
  function ensureAudio() {
    if (!soundEnabled) return null;
    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playTone(freq, duration, type = "sine", volume = 0.12) {
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function playBallotChime() {
    playTone(660, 0.14, "triangle", 0.1);
  }

  function playRouletteTick(stepIndex) {
    const pitch = 240 + Math.min(stepIndex * 18, 420);
    playTone(pitch, 0.08, "sawtooth", 0.08);
  }

  function playGrandVictorySound() {
    const ctx = ensureAudio();
    if (ctx) {
      try {
        // Dentuman Bass Timpani
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bassOsc.type = "sine";
        bassOsc.frequency.setValueAtTime(140, ctx.currentTime);
        bassOsc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.85);
        bassGain.gain.setValueAtTime(0.38, ctx.currentTime);
        bassGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
        bassOsc.connect(bassGain);
        bassGain.connect(ctx.destination);
        bassOsc.start();
        bassOsc.stop(ctx.currentTime + 0.92);
      } catch (_) {}
    }

    // Fanfare Terompet Kemenangan
    const brassNotes = [
      { f: 523.25, t: 0, d: 0.22 },
      { f: 659.25, t: 120, d: 0.22 },
      { f: 783.99, t: 240, d: 0.26 },
      { f: 1046.5, t: 380, d: 0.75 },
      { f: 783.99, t: 620, d: 0.2 },
      { f: 880.0, t: 760, d: 0.2 },
      { f: 1046.5, t: 920, d: 1.25 }
    ];
    brassNotes.forEach((n) => {
      setTimeout(() => {
        playTone(n.f, n.d, "triangle", 0.16);
        playTone(n.f * 0.5, n.d, "sawtooth", 0.06);
      }, n.t);
    });
  }

  // ==========================================================================
  // 2. MESIN EFEK VISUAL (KEMBANG API, KONFETI METALIK & BARA EMAS)
  // ==========================================================================
  function stopCanvasFx() {
    if (fxAnimId) {
      cancelAnimationFrame(fxAnimId);
      fxAnimId = null;
    }
    if (fxCanvas) {
      const ctx = fxCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    }
  }

  function startGrandFx() {
    stopCanvasFx();
    if (!fxCanvas) return;
    const ctx = fxCanvas.getContext("2d");
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;

    const goldPalette = ["#FDE68A", "#F59E0B", "#D97706", "#FFFFFF", "#EF4444"];

    // 1. Pita Konfeti 3D
    const confetti = Array.from({ length: 120 }, () => ({
      x: Math.random() * fxCanvas.width,
      y: Math.random() * -fxCanvas.height,
      w: Math.random() * 11 + 6,
      h: Math.random() * 6 + 4,
      color: goldPalette[Math.floor(Math.random() * goldPalette.length)],
      vx: (Math.random() - 0.5) * 2.6,
      vy: Math.random() * 2.8 + 1.8,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.15,
      wobble: Math.random() * Math.PI * 2
    }));

    // 2. Partikel Bara Emas Naik dari Bawah
    const embers = Array.from({ length: 45 }, () => ({
      x: Math.random() * fxCanvas.width,
      y: fxCanvas.height + Math.random() * 120,
      r: Math.random() * 2.6 + 1,
      vy: -(Math.random() * 1.6 + 0.7),
      vx: (Math.random() - 0.5) * 0.8,
      alpha: Math.random() * 0.7 + 0.3
    }));

    // 3. Kembang Api Otomatis
    const rockets = [];
    const sparks = [];
    let tick = 0;

    function launchRocket() {
      rockets.push({
        x: fxCanvas.width * (0.15 + Math.random() * 0.7),
        y: fxCanvas.height + 10,
        targetY: fxCanvas.height * (0.14 + Math.random() * 0.3),
        vy: -(Math.random() * 5 + 9),
        color: goldPalette[Math.floor(Math.random() * goldPalette.length)]
      });
    }

    function explodeRocket(r) {
      const count = 48;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.12;
        const speed = Math.random() * 5.2 + 1.8;
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: Math.random() * 0.018 + 0.014,
          color: r.color,
          size: Math.random() * 2.5 + 1.4
        });
      }
    }

    // Luncurkan 3 roket awal bersamaan
    launchRocket();
    launchRocket();
    launchRocket();

    function renderLoop() {
      tick += 1;
      ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

      // Peluncuran roket berkala
      if (tick % 48 === 0 && rockets.length < 4) {
        launchRocket();
      }

      // Gambar & update roket
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy;
        r.vy *= 0.97;

        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#FEF08A";
        ctx.fill();

        if (r.y <= r.targetY || r.vy > -1.8) {
          explodeRocket(r);
          rockets.splice(i, 1);
        }
      }

      // Gambar & update percikan kembang api
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08; // gravitasi
        s.vx *= 0.97;
        s.alpha -= s.decay;

        if (s.alpha <= 0) {
          sparks.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.restore();
      }

      // Gambar bara emas naik
      embers.forEach((e) => {
        e.x += e.vx;
        e.y += e.vy;
        if (e.y < -10) {
          e.y = fxCanvas.height + 10;
          e.x = Math.random() * fxCanvas.width;
        }
        ctx.save();
        ctx.globalAlpha = e.alpha;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = "#FBBF24";
        ctx.fill();
        ctx.restore();
      });

      // Gambar konfeti metalik
      confetti.forEach((p) => {
        p.wobble += 0.08;
        p.x += p.vx + Math.sin(p.wobble) * 0.7;
        p.y += p.vy;
        p.rot += p.spin;
        if (p.y > fxCanvas.height + 20) {
          p.y = -15;
          p.x = Math.random() * fxCanvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(p.wobble), 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      fxAnimId = requestAnimationFrame(renderLoop);
    }

    renderLoop();
  }

  // ==========================================================================
  // 3. PENGACAKAN & TAMPILAN KARTU KANDIDAT
  // ==========================================================================
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
    if (!candidates || candidates.length === 0) {
      gridEl.innerHTML = `
        <div style="grid-column:1/-1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); border-radius:16px; padding:2rem; text-align:center;">
          <h2 style="font-size:1.2rem; margin-bottom:0.5rem;">Belum Ada Calon Ketua Aktif</h2>
          <p style="color:#D4D4D8; font-size:0.9rem;">
            Tambahkan kandidat di menu <strong>2. Candidates</strong> pada Dashboard Panitia terlebih dahulu, lalu muat ulang halaman ini.
          </p>
        </div>
      `;
      return;
    }

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

  // ==========================================================================
  // 4. SEKUENS PENGESAHAN 3-FASE (ROULETTE -> IMPACT -> GRAND REVEAL)
  // ==========================================================================
  function clearSuspenseTimers() {
    suspenseTimers.forEach((t) => clearTimeout(t));
    suspenseTimers = [];
  }

  function openWinnerCeremony(winner, votesCount) {
    if (!winner || !ceremonyOverlay) return;
    clearSuspenseTimers();
    stopCanvasFx();

    lastCrownedWinner = winner;
    lastCrownedVotes = votesCount;

    const total = Math.max(ballotDeck.length, 1);
    const pct = ((votesCount / total) * 100).toFixed(1);
    const numFormatted = String(winner.candidate_number).padStart(2, "0");
    const initials = getInitials(winner.full_name);
    const safeName = Utils.escapeHTML(winner.full_name);

    // Siapkan isi kartu pengesahan terlebih dahulu
    document.getElementById("ceremony-org-header").textContent = orgNameLabel;
    document.getElementById("ceremony-title-heading").textContent =
      `KETUA TERPILIH PERIODE ${periodLabel}`;
    document.getElementById("ceremony-number-digits").textContent = numFormatted;
    document.getElementById("ceremony-winner-name").textContent = winner.full_name;
    document.getElementById("ceremony-vote-stats").textContent =
      `Perolehan Sah: ${votesCount} dari ${ballotDeck.length} Suara (${pct}%)`;

    const photoSlot = document.getElementById("ceremony-photo-slot");
    photoSlot.innerHTML = winner.photo_url
      ? `<img src="${Utils.escapeHTML(winner.photo_url)}" alt="${safeName}" class="ceremony-photo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="ceremony-photo-initials" style="display:none;">${initials}</div>`
      : `<div class="ceremony-photo-initials">${initials}</div>`;

    // Reset state visual ke Fase 1 (Roulette Ketegangan)
    ceremonyOverlay.classList.remove("hidden", "screen-shake");
    ceremonyFlash.classList.remove("trigger");
    shockwave1.classList.remove("fire");
    shockwave2.classList.remove("fire");
    ceremonyCard.classList.add("hidden");
    suspenseStage.classList.remove("hidden");
    suspenseKicker.textContent = "DAN KETUA TERPILIH ADALAH...";

    const candidateNums = candidates.length > 0
      ? candidates.map((c) => String(c.candidate_number).padStart(2, "0"))
      : ["01", "02"];

    // Jadwal putaran roulette nomor urut yang makin melambat
    const delays = [0, 80, 160, 250, 350, 460, 580, 720, 880, 1060, 1260, 1490, 1750, 2050];
    delays.forEach((ms, idx) => {
      const t = setTimeout(() => {
        const displayNum = idx === delays.length - 1
          ? numFormatted
          : candidateNums[idx % candidateNums.length];
        rouletteDigits.textContent = displayNum;
        playRouletteTick(idx);
      }, ms);
      suspenseTimers.push(t);
    });

    // Fase 2 & 3: Ledakan Cahaya + Screen Shake + Munculkan Kartu Pengesahan
    const revealTimerFinal = setTimeout(() => {
      suspenseStage.classList.add("hidden");

      // Picu kilatan, shockwave, dan screen shake
      void ceremonyOverlay.offsetWidth;
      ceremonyOverlay.classList.add("screen-shake");
      ceremonyFlash.classList.add("trigger");
      shockwave1.classList.add("fire");
      shockwave2.classList.add("fire");

      ceremonyCard.classList.remove("hidden");
      showCeremonyBtn.classList.remove("hidden");

      playGrandVictorySound();
      startGrandFx();
    }, 2400);

    suspenseTimers.push(revealTimerFinal);
  }

  function closeWinnerCeremony() {
    clearSuspenseTimers();
    if (ceremonyOverlay) ceremonyOverlay.classList.add("hidden");
    stopCanvasFx();
  }

  function finishReveal() {
    isRunning = false;
    isPaused = false;
    clearTimeout(revealTimer);

    pauseBtn.classList.add("hidden");
    skipBtn.classList.add("hidden");
    resetBtn.classList.remove("hidden");

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
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI • MEMBUKA LAYAR PENGESAHAN...";
      ballotHeadline.textContent = `Suara Terbanyak: Nomor Urut ${num} — ${w.full_name} (${maxVotes} Suara)`;

      ceremonyDelayTimer = setTimeout(() => {
        openWinnerCeremony(w, maxVotes);
      }, 1100);
    } else if (winners.length > 1) {
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI • HASIL IMBANG";
      ballotHeadline.textContent = `Terdapat perolehan suara imbang (${maxVotes} suara). Keputusan mengikuti tata tertib musyawarah.`;
      playGrandVictorySound();
    } else {
      ballotMeta.textContent = "PENGHITUNGAN SUARA SELESAI";
      ballotHeadline.textContent = "Belum ada surat suara yang masuk.";
    }
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
    clearTimeout(ceremonyDelayTimer);
    closeWinnerCeremony();
    lastCrownedWinner = null;

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

    if (ballotDeck.length === 0) {
      ballotMeta.textContent = "KOTAK SUARA KOSONG (0 SUARA MASUK)";
      ballotHeadline.textContent = "Belum ada suara masuk. Jalankan simulasi atau buka pemilihan terlebih dahulu.";
    } else {
      ballotMeta.textContent = "KOTAK SUARA TERSEGEL • SIAP DIBACAKAN";
      ballotHeadline.textContent = 'Tekan tombol "Mulai Pembacaan Suara" untuk memulai';
    }

    startBtn.disabled = ballotDeck.length === 0;
    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    pauseBtn.textContent = "Jeda (Pause)";
    resetBtn.classList.add("hidden");
    skipBtn.classList.add("hidden");
    showCeremonyBtn.classList.add("hidden");
  }

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

  if (showCeremonyBtn) {
    showCeremonyBtn.addEventListener("click", () => {
      if (lastCrownedWinner) {
        openWinnerCeremony(lastCrownedWinner, lastCrownedVotes);
      }
    });
  }

  if (closeCeremonyBtn) {
    closeCeremonyBtn.addEventListener("click", closeWinnerCeremony);
  }

  if (replayConfettiBtn) {
    replayConfettiBtn.addEventListener("click", () => {
      if (lastCrownedWinner) {
        openWinnerCeremony(lastCrownedWinner, lastCrownedVotes);
      }
    });
  }

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

  window.addEventListener("resize", () => {
    if (fxCanvas && !ceremonyOverlay.classList.contains("hidden")) {
      fxCanvas.width = window.innerWidth;
      fxCanvas.height = window.innerHeight;
    }
  });

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

      if (settings) {
        if (settings.org_name) orgNameLabel = settings.org_name.toUpperCase();
        if (settings.period_label) periodLabel = settings.period_label;

        const mainTitleEl = document.getElementById("proj-main-title");
        const subTitleEl = document.getElementById("proj-subtitle");
        if (mainTitleEl) {
          mainTitleEl.textContent = `LIVE COUNT — PEMILIHAN KETUA PERIODE ${periodLabel}`;
        }
        if (subTitleEl) {
          subTitleEl.textContent = `${orgNameLabel} • PEMBACAAN SURAT SUARA VIRTUAL`;
        }

        if (settings.status === "OPEN") {
          Utils.showAlert(
            "proj-alert",
            "warning",
            "Perhatian: Status pemilihan masih OPEN. Tutup pemilihan (CLOSED) terlebih dahulu di menu Election Control agar tidak ada suara susulan saat pembacaan dimulai."
          );
        }
      }

      const { data: dbCandidates } = await supabase
        .from("candidates")
        .select("id, candidate_number, full_name, photo_url, is_active")
        .eq("position", "CHAIRPERSON")
        .eq("is_active", true)
        .order("candidate_number", { ascending: true });

      const photoMap = {};
      (dbCandidates || []).forEach((item) => {
        photoMap[item.id] = item.photo_url || null;
      });

      const { data: tally, error: tallyErr } = await supabase.rpc("get_election_tally");
      if (tallyErr) throw tallyErr;

      const tallyList = (tally && Array.isArray(tally.chairperson) && tally.chairperson.length > 0)
        ? tally.chairperson
        : (dbCandidates || []).map((c) => ({
            id: c.id,
            candidate_number: c.candidate_number,
            full_name: c.full_name,
            votes: 0
          }));

      candidates = tallyList.map((c) => ({
        ...c,
        photo_url: photoMap[c.id] || null
      }));

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
      participationPill.textContent = `Total Partisipasi: ${(tally && tally.total_voted) || ballotDeck.length} Anggota Hadir`;

      renderInitialCards();
      resetAllToZero();
    } catch (err) {
      Utils.showAlert("proj-alert", "error", SbService.mapFriendlyError(err));
    }
  });
})();

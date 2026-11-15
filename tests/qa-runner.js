/**
 * PASMANTAB e-VOTING 2026 — Automated Security & 80-Concurrent-Voters Load Tester
 */
(function () {
  const Utils = window.PasmantabUtils;
  const SbService = window.SupabaseService;

  const tbody = document.getElementById("qa-results-tbody");
  const runBtn = document.getElementById("btn-run-all-tests");
  const tokenInput = document.getElementById("qa-token-input");

  let stepCounter = 0;

  function appendRow(scenario, expected, actual, passed) {
    stepCounter += 1;
    const badge = passed
      ? '<span class="badge badge-open">LULUS (PASS)</span>'
      : '<span class="badge badge-closed">GAGAL (FAIL)</span>';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${stepCounter}</td>
      <td><strong>${Utils.escapeHTML(scenario)}</strong></td>
      <td>${Utils.escapeHTML(expected)}</td>
      <td>${Utils.escapeHTML(actual)}</td>
      <td>${badge}</td>
    `;
    tbody.appendChild(tr);
  }

  runBtn.addEventListener("click", async () => {
    Utils.hideAlert("qa-alert");
    const rawToken = Utils.normalizeCode(tokenInput.value);

    if (rawToken.length < 6) {
      Utils.showAlert("qa-alert", "error", "Masukkan Kode Token aktif terlebih dahulu.");
      tokenInput.focus();
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "Sedang Menjalankan Simulasi...";
    tbody.innerHTML = "";
    stepCounter = 0;

    let securityPassed = 0;
    const totalSecurityChecks = 4;

    try {
      const supabase = SbService.getClient();

      // Pastikan ada kandidat aktif yang dapat dipilih dalam simulasi
      const { data: candidates, error: candErr } = await supabase
        .from("candidates")
        .select("id, full_name")
        .eq("position", "CHAIRPERSON")
        .eq("is_active", true)
        .order("candidate_number", { ascending: true });

      if (candErr || !candidates || candidates.length === 0) {
        throw new Error("Tidak ditemukan kandidat Ketua aktif. Jalankan Bagian A pada tests/qa_80_voters.sql terlebih dahulu.");
      }

      // Gunakan klien anonim terpisah (tanpa sesi admin) untuk menguji celah keamanan publik
      const anonClient = window.supabase.createClient(
        window.PASMANTAB_CONFIG.SUPABASE_URL,
        window.PASMANTAB_CONFIG.SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      );

      // ======================================================================
      // TEST 1: SECURITY — RLS PEMBLOKIRAN TABEL VOTERS DARI PUBLIK
      // ======================================================================
      const { data: leakedVoters } = await anonClient.from("voters").select("*");
      const test1Pass = !leakedVoters || leakedVoters.length === 0;
      if (test1Pass) securityPassed += 1;
      appendRow(
        "Keamanan RLS: Akses Anonim ke Daftar Pemilih (voters)",
        "0 baris dikembalikan (diblokir RLS)",
        `${(leakedVoters && leakedVoters.length) || 0} baris terbaca`,
        test1Pass
      );

      // ======================================================================
      // TEST 2: SECURITY — PEMBLOKIRAN HASIL SAAT PEMILIHAN MASIH OPEN
      // ======================================================================
      const { error: tallyLeakErr } = await anonClient.rpc("get_election_tally");
      const test2Pass = Boolean(tallyLeakErr);
      if (test2Pass) securityPassed += 1;
      appendRow(
        "Keamanan Privasi: Pemilih Mengintip Hasil Sebelum Ditutup",
        "Ditolak oleh fungsi RPC server",
        test2Pass ? `Ditolak (${tallyLeakErr.message})` : "BERBAHAYA: Hasil terbaca!",
        test2Pass
      );

      // ======================================================================
      // TEST 3: SECURITY — PENOLAKAN ID KANDIDAT PALSU
      // ======================================================================
      const fakeCandidateId = "00000000-0000-0000-0000-000000000000";
      const { error: fakeCandErr } = await anonClient.rpc("cast_ballot_atomic", {
        p_full_name: "Simulasi Pemilih 01",
        p_class_name: "QA-SIMULASI",
        p_raw_token: rawToken,
        p_chairperson_id: fakeCandidateId
      });
      const test3Pass = Boolean(fakeCandErr && fakeCandErr.message.includes("INVALID_CANDIDATE"));
      if (test3Pass) securityPassed += 1;
      appendRow(
        "Validasi Input: Kirim Suara dengan ID Kandidat Palsu",
        "Ditolak dengan error INVALID_CANDIDATE",
        fakeCandErr ? fakeCandErr.message : "Lolos tanpa error",
        test3Pass
      );

      // ======================================================================
      // TEST 4: RACE CONDITION — 10 REQUEST BERSAMAAN DENGAN 1 IDENTITAS SAMA
      // ======================================================================
      const chosenForRace = candidates[0].id;
      const racePromises = Array.from({ length: 10 }, () =>
        anonClient.rpc("cast_ballot_atomic", {
          p_full_name: "Simulasi Pemilih 01",
          p_class_name: "QA-SIMULASI",
          p_raw_token: rawToken,
          p_chairperson_id: chosenForRace
        })
      );

      const raceResults = await Promise.all(racePromises);
      const raceSuccessCount = raceResults.filter((r) => !r.error && r.data && r.data.success).length;
      const raceRejectedCount = raceResults.filter((r) => r.error).length;
      const test4Pass = raceSuccessCount === 1 && raceRejectedCount === 9;
      if (test4Pass) securityPassed += 1;

      appendRow(
        "Anti Race-Condition: 10 Klik Serentak oleh 1 Pemilih (Pemilih 01)",
        "Tepat 1 suara diterima, 9 ditolak",
        `${raceSuccessCount} diterima, ${raceRejectedCount} ditolak`,
        test4Pass
      );

      document.getElementById("qa-sec-score").textContent = `${securityPassed} / ${totalSecurityChecks}`;

      // ======================================================================
      // TEST 5: LOAD TEST — 79 PEMILIH LAINNYA LOGIN & KIRIM SUARA SERENTAK
      // (Total bersama Pemilih 01 = 80 Pemilih Simulasi)
      // ======================================================================
      const waveStart = performance.now();
      const voterJobs = [];

      for (let i = 2; i <= 80; i++) {
        const padded = String(i).padStart(2, "0");
        const voterName = `Simulasi Pemilih ${padded}`;
        const voterClass = "QA-SIMULASI";
        // Bagi pilihan secara bergantian di antara kandidat aktif
        const candidateId = candidates[i % candidates.length].id;

        const job = (async () => {
          const t0 = performance.now();
          // Tahap 1: Verifikasi akses (sama seperti halaman verify.html)
          const verRes = await anonClient.rpc("verify_voter_access", {
            p_full_name: voterName,
            p_class_name: voterClass,
            p_raw_token: rawToken
          });
          if (verRes.error) {
            return { ok: false, step: "verify", error: verRes.error.message, ms: performance.now() - t0 };
          }

          // Tahap 2: Kirim surat suara atomik (sama seperti halaman review.html)
          const castRes = await anonClient.rpc("cast_ballot_atomic", {
            p_full_name: voterName,
            p_class_name: voterClass,
            p_raw_token: rawToken,
            p_chairperson_id: candidateId
          });
          if (castRes.error) {
            return { ok: false, step: "cast", error: castRes.error.message, ms: performance.now() - t0 };
          }

          return { ok: true, ms: performance.now() - t0 };
        })();

        voterJobs.push(job);
      }

      const waveResults = await Promise.all(voterJobs);
      const waveTotalMs = performance.now() - waveStart;

      const waveSuccess = waveResults.filter((r) => r.ok).length;
      const totalAll80 = raceSuccessCount + waveSuccess;
      const avgMs =
        waveResults.reduce((sum, r) => sum + r.ms, 0) / Math.max(waveResults.length, 1);

      document.getElementById("qa-load-success").textContent = `${totalAll80} / 80`;
      document.getElementById("qa-load-duration").textContent = `${(waveTotalMs / 1000).toFixed(2)} dtk`;
      document.getElementById("qa-load-avg").textContent = `${Math.round(avgMs)} ms`;

      const failedSamples = waveResults.filter((r) => !r.ok).slice(0, 3);
      const failDetail =
        failedSamples.length > 0
          ? ` | Contoh error: ${failedSamples.map((f) => `${f.step}: ${f.error}`).join("; ")}`
          : "";

      appendRow(
        "Uji Beban (Load Test): 80 Pemilih Verifikasi & Kirim Suara Bersamaan",
        "80 / 80 suara masuk tanpa satupun hilang",
        `${totalAll80} / 80 suara tercatat dalam ${(waveTotalMs / 1000).toFixed(2)} detik${failDetail}`,
        totalAll80 === 80
      );

      if (totalAll80 === 80 && securityPassed === totalSecurityChecks) {
        Utils.showAlert(
          "qa-alert",
          "success",
          "SELURUH PENGUJIAN LULUS 100%! Sistem terbukti aman dan sanggup menangani 80 pemilih secara bersamaan."
        );
      } else {
        Utils.showAlert(
          "qa-alert",
          "warning",
          "Pengujian selesai. Periksa tabel di bawah untuk melihat detail skenario yang perlu diperbaiki."
        );
      }
    } catch (err) {
      Utils.showAlert("qa-alert", "error", SbService.mapFriendlyError(err));
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "JALANKAN UJI KEAMANAN & SIMULASI 80 PEMILIH BERSAMAAN";
    }
  });
})();
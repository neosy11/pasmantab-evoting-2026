/**
 * PASMANTAB e-VOTING 2026 — Atomic Voting Engine & Network Recovery
 */
window.VotingEngine = (function () {
  const SbService = window.SupabaseService;
  let activeSubmissionLock = false;

  /**
   * Pastikan perangkat memiliki koneksi internet sebelum mengirim request
   */
  function ensureOnline() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("OFFLINE_DEVICE");
    }
  }

  /**
   * Pembungkus Promise dengan batas waktu (timeout) agar UI tidak menggantung selamanya
   */
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("NETWORK_TIMEOUT"));
      }, ms);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * 1. Verifikasi hak akses pemilih (Nama + Kelas + Token Bersama)
   */
  async function verifyAccess(fullName, className, rawToken) {
    ensureOnline();
    const supabase = SbService.getClient();

    const { data, error } = await withTimeout(
      supabase.rpc("verify_voter_access", {
        p_full_name: fullName,
        p_class_name: className,
        p_raw_token: rawToken
      }),
      15000
    );

    if (error) throw error;
    if (!data || !data.valid) {
      throw new Error("INVALID_OR_EXPIRED_TOKEN");
    }
    return data;
  }

  /**
   * 2. Kirim surat suara atomik dengan pemulihan otomatis jika jaringan terputus
   */
  async function submitBallotAtomic({ voterName, voterClass, rawToken, chairpersonId }) {
    if (activeSubmissionLock) {
      throw new Error("SUBMISSION_IN_PROGRESS");
    }

    ensureOnline();
    activeSubmissionLock = true;

    try {
      const supabase = SbService.getClient();
      const { data, error } = await withTimeout(
        supabase.rpc("cast_ballot_atomic", {
          p_full_name: voterName,
          p_class_name: voterClass,
          p_raw_token: rawToken,
          p_chairperson_id: chairpersonId
        }),
        18000
      );

      if (error) throw error;
      if (!data || !data.success) {
        throw new Error("Transaksi suara gagal dikonfirmasi oleh server.");
      }

      return { success: true, recovered: false };
    } catch (err) {
      const rawMsg = String((err && err.message) || "").toUpperCase();

      // Jika error disebabkan gangguan jaringan / timeout setelah tombol ditekan,
      // cek apakah server sebenarnya sudah berhasil merekam suara pemilih ini.
      const isNetworkIssue =
        rawMsg.includes("FAILED TO FETCH") ||
        rawMsg.includes("NETWORK") ||
        rawMsg.includes("TIMEOUT");

      if (isNetworkIssue && navigator.onLine !== false) {
        try {
          const supabase = SbService.getClient();
          const { data: statusData } = await withTimeout(
            supabase.rpc("check_voter_ballot_status", {
              p_full_name: voterName,
              p_class_name: voterClass,
              p_raw_token: rawToken
            }),
            10000
          );

          if (statusData && statusData.has_voted === true) {
            return { success: true, recovered: true };
          }
        } catch (_) {
          // Jika pengecekan pemulihan juga gagal, lempar error asli ke pengguna
        }
      }

      throw err;
    } finally {
      activeSubmissionLock = false;
    }
  }

  return {
    verifyAccess,
    submitBallotAtomic
  };
})();
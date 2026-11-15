/**
 * PASMANTAB e-VOTING 2026 — Atomic Voting Engine & 1-Device-1-Vote Lock
 */
window.VotingEngine = (function () {
  const SbService = window.SupabaseService;
  const DEVICE_UID_KEY = "pasmantab_device_uid_v1";
  const DEVICE_VOTED_KEY = "pasmantab_device_voted_flag_v1";
  let activeSubmissionLock = false;

  function ensureOnline() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("OFFLINE_DEVICE");
    }
  }

  /**
   * Menghasilkan identitas perangkat unik dari kombinasi karakteristik layar/browser
   * (tetap konsisten meskipun pemilih membuka tab Incognito di HP yang sama)
   */
  function getDeviceFingerprint() {
    try {
      const nav = window.navigator || {};
      const scr = window.screen || {};
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const hwSignature = [
        nav.platform || "",
        nav.hardwareConcurrency || "",
        scr.width || "",
        scr.height || "",
        scr.colorDepth || "",
        tz,
        nav.language || ""
      ].join("|");

      let storedUid = localStorage.getItem(DEVICE_UID_KEY);
      if (!storedUid) {
        storedUid = "dev_" + Math.random().toString(36).slice(2, 12) + "_" + Date.now().toString(36);
        localStorage.setItem(DEVICE_UID_KEY, storedUid);
      }

      // Gunakan hardware signature utama agar Incognito di HP yang sama tetap terdeteksi
      return `HW:${hwSignature}`;
    } catch (_) {
      return "HW:FALLBACK_DEVICE";
    }
  }

  function isDeviceLockedLocally() {
    try {
      if (localStorage.getItem(DEVICE_VOTED_KEY) === "true") return true;
      if (document.cookie.includes(`${DEVICE_VOTED_KEY}=true`)) return true;
    } catch (_) {}
    return false;
  }

  function markDeviceVotedLocally() {
    try {
      localStorage.setItem(DEVICE_VOTED_KEY, "true");
      document.cookie = `${DEVICE_VOTED_KEY}=true; max-age=2592000; path=/; SameSite=Strict`;
    } catch (_) {}
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("NETWORK_TIMEOUT")), ms);
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

  async function verifyAccess(fullName, className, rawToken) {
    if (isDeviceLockedLocally()) {
      throw new Error("DEVICE_ALREADY_VOTED");
    }

    ensureOnline();
    const supabase = SbService.getClient();
    const deviceId = getDeviceFingerprint();

    const { data, error } = await withTimeout(
      supabase.rpc("verify_voter_access", {
        p_full_name: fullName,
        p_class_name: className,
        p_raw_token: rawToken,
        p_device_id: deviceId
      }),
      15000
    );

    if (error) throw error;
    if (!data || !data.valid) {
      throw new Error("INVALID_OR_EXPIRED_TOKEN");
    }
    return data;
  }

  async function submitBallotAtomic({ voterName, voterClass, rawToken, chairpersonId }) {
    if (isDeviceLockedLocally()) {
      throw new Error("DEVICE_ALREADY_VOTED");
    }
    if (activeSubmissionLock) {
      throw new Error("SUBMISSION_IN_PROGRESS");
    }

    ensureOnline();
    activeSubmissionLock = true;

    try {
      const supabase = SbService.getClient();
      const deviceId = getDeviceFingerprint();

      const { data, error } = await withTimeout(
        supabase.rpc("cast_ballot_atomic", {
          p_full_name: voterName,
          p_class_name: voterClass,
          p_raw_token: rawToken,
          p_chairperson_id: chairpersonId,
          p_device_id: deviceId
        }),
        18000
      );

      if (error) throw error;
      if (!data || !data.success) {
        throw new Error("Transaksi suara gagal dikonfirmasi oleh server.");
      }

      markDeviceVotedLocally();
      return { success: true, recovered: false };
    } catch (err) {
      const rawMsg = String((err && err.message) || "").toUpperCase();
      if (rawMsg.includes("DEVICE_ALREADY_VOTED") || rawMsg.includes("ALREADY_VOTED")) {
        markDeviceVotedLocally();
      }
      throw err;
    } finally {
      activeSubmissionLock = false;
    }
  }

  return {
    isDeviceLockedLocally,
    verifyAccess,
    submitBallotAtomic
  };
})();

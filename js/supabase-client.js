/**
 * PASMANTAB e-VOTING 2026 — Supabase Client, VotingEngine & RPC Bridge
 */
(function () {
  let supabaseInstance = null;
  let isSubmittingBallot = false;

  function resolveConfig() {
    const cfg =
      window.PASMANTAB_CONFIG ||
      window.APP_CONFIG ||
      window.SUPABASE_CONFIG ||
      {};

    const url =
      cfg.SUPABASE_URL ||
      cfg.supabaseUrl ||
      window.SUPABASE_URL ||
      "";

    const anonKey =
      cfg.SUPABASE_ANON_KEY ||
      cfg.supabaseAnonKey ||
      window.SUPABASE_ANON_KEY ||
      "";

    return { url, anonKey };
  }

  function getClient() {
    if (supabaseInstance) return supabaseInstance;

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Library Supabase JS belum dimuat.");
    }

    const { url, anonKey } = resolveConfig();
    if (!url || !anonKey) {
      throw new Error("Konfigurasi SUPABASE_URL atau SUPABASE_ANON_KEY belum diatur di js/config.js.");
    }

    supabaseInstance = window.supabase.createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    return supabaseInstance;
  }

  function getOrCreateDeviceId() {
    try {
      if (
        window.PasmantabUtils &&
        typeof window.PasmantabUtils.getDeviceId === "function"
      ) {
        const utilId = window.PasmantabUtils.getDeviceId();
        if (utilId) return utilId;
      }

      const storageKey = "pasmantab_device_id";
      let existing =
        localStorage.getItem(storageKey) ||
        localStorage.getItem("pasmantab_hw_id");
      if (existing) return existing;

      const randomPart =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

      existing = `HW:${randomPart}`;
      localStorage.setItem(storageKey, existing);
      return existing;
    } catch (_) {
      return `HW:SESSION_${Date.now().toString(36)}`;
    }
  }

  function mapFriendlyError(err) {
    console.error("[PASMANTAB SYSTEM DETAIL]:", err);

    const raw = String(
      (err && (err.message || err.error_description || err.details)) || err || ""
    ).toUpperCase();

    if (raw.includes("DEVICE_ALREADY_VOTED")) {
      return "Perangkat (HP/Laptop) ini sudah digunakan untuk memberikan suara. Satu perangkat hanya berlaku untuk satu pemilih.";
    }
    if (raw.includes("ALREADY_VOTED") || raw.includes("VOTER_ALREADY_VOTED")) {
      return "Identitas Anda (nama & kelas) tercatat sudah menggunakan hak suara sebelumnya.";
    }
    if (raw.includes("TOKEN_EXPIRED")) {
      return "Masa berlaku kode token telah habis. Silakan minta kode token aktif kepada panitia.";
    }
    if (raw.includes("TOKEN_REVOKED") || raw.includes("TOKEN_INACTIVE")) {
      return "Kode token sudah dinonaktifkan oleh panitia.";
    }
    if (raw.includes("INVALID_TOKEN") || raw.includes("TOKEN_NOT_FOUND")) {
      return "Kode token tidak valid atau tidak ditemukan. Periksa kembali huruf dan angkanya.";
    }
    if (raw.includes("ELECTION_NOT_OPEN") || raw.includes("ELECTION_CLOSED")) {
      return "Sesi pemungutan suara saat ini sedang ditutup oleh panitia.";
    }
    if (raw.includes("INVALID_CANDIDATE")) {
      return "Kandidat yang dipilih tidak valid atau sudah tidak aktif.";
    }
    if (raw.includes("INVALID LOGIN CREDENTIALS")) {
      return "Email atau kata sandi panitia tidak sesuai.";
    }
    if (raw.includes("FAILED TO FETCH") || raw.includes("NETWORKERROR")) {
      return "Koneksi internet terputus atau tidak stabil. Periksa jaringan Anda lalu coba lagi.";
    }

    return "Terjadi gangguan pada sistem. Silakan coba beberapa saat lagi atau hubungi panitia.";
  }

  function normalizeVoterArgs(arg1, className, rawToken, deviceId) {
    if (arg1 && typeof arg1 === "object") {
      return {
        p_full_name:
          arg1.p_full_name || arg1.fullName || arg1.full_name || arg1.voterName || arg1.name || "",
        p_class_name:
          arg1.p_class_name || arg1.className || arg1.class_name || arg1.voterClass || arg1.kelas || "",
        p_raw_token:
          arg1.p_raw_token || arg1.rawToken || arg1.raw_token || arg1.token || arg1.tokenCode || "",
        p_device_id:
          arg1.p_device_id || arg1.deviceId || arg1.device_id || getOrCreateDeviceId()
      };
    }
    return {
      p_full_name: arg1 || "",
      p_class_name: className || "",
      p_raw_token: rawToken || "",
      p_device_id: deviceId || getOrCreateDeviceId()
    };
  }

  function normalizeBallotArgs(arg1, className, rawToken, chairpersonId, deviceId) {
    if (arg1 && typeof arg1 === "object") {
      return {
        p_full_name:
          arg1.p_full_name || arg1.fullName || arg1.full_name || arg1.voterName || arg1.name || "",
        p_class_name:
          arg1.p_class_name || arg1.className || arg1.class_name || arg1.voterClass || arg1.kelas || "",
        p_raw_token:
          arg1.p_raw_token || arg1.rawToken || arg1.raw_token || arg1.token || arg1.tokenCode || "",
        p_chairperson_id:
          arg1.p_chairperson_id ||
          arg1.chairpersonId ||
          arg1.chairperson_id ||
          arg1.candidateId ||
          arg1.candidate_id ||
          null,
        p_device_id:
          arg1.p_device_id || arg1.deviceId || arg1.device_id || getOrCreateDeviceId()
      };
    }
    return {
      p_full_name: arg1 || "",
      p_class_name: className || "",
      p_raw_token: rawToken || "",
      p_chairperson_id: chairpersonId || null,
      p_device_id: deviceId || getOrCreateDeviceId()
    };
  }

  const rpcBridge = {
    getDeviceId: getOrCreateDeviceId,

    async verifyVoterAccess(arg1, className, rawToken, deviceId) {
      const client = getClient();
      const params = normalizeVoterArgs(arg1, className, rawToken, deviceId);
      const { data, error } = await client.rpc("verify_voter_access", params);
      if (error) throw error;
      return data || { ok: true };
    },

    async submitBallotAtomic(arg1, className, rawToken, chairpersonId, deviceId) {
      if (isSubmittingBallot) {
        throw new Error("SUBMISSION_IN_PROGRESS");
      }
      isSubmittingBallot = true;
      try {
        const client = getClient();
        const params = normalizeBallotArgs(
          arg1,
          className,
          rawToken,
          chairpersonId,
          deviceId
        );
        const { data, error } = await client.rpc("cast_ballot_atomic", params);
        if (error) throw error;
        return data || { ok: true };
      } finally {
        isSubmittingBallot = false;
      }
    },

    async castBallotAtomic(arg1, className, rawToken, chairpersonId, deviceId) {
      return rpcBridge.submitBallotAtomic(
        arg1,
        className,
        rawToken,
        chairpersonId,
        deviceId
      );
    },

    async getElectionTally() {
      const client = getClient();
      const { data, error } = await client.rpc("get_election_tally");
      if (error) throw error;
      return data;
    }
  };

  window.SupabaseService = {
    getClient,
    mapFriendlyError,
    rpc: rpcBridge,
    verifyVoterAccess: rpcBridge.verifyVoterAccess,
    submitBallotAtomic: rpcBridge.submitBallotAtomic,
    castBallotAtomic: rpcBridge.castBallotAtomic,
    getElectionTally: rpcBridge.getElectionTally
  };

  window.VotingEngine = Object.assign(window.VotingEngine || {}, rpcBridge);
})();

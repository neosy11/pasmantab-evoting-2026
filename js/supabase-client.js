/**
 * PASMANTAB e-VOTING 2026 — Supabase Client, VotingEngine & Anti-Fraud Device Lock
 */
(function () {
  let supabaseInstance = null;
  let isSubmittingBallot = false;

  const DEVICE_KEY = "pasmantab_device_id_v2";
  const VOTED_LOCK_KEY = "pasmantab_device_voted_v2";

  function resolveConfig() {
    const cfg =
      window.PASMANTAB_CONFIG ||
      window.APP_CONFIG ||
      window.SUPABASE_CONFIG ||
      {};

    return {
      url: cfg.SUPABASE_URL || cfg.supabaseUrl || window.SUPABASE_URL || "",
      anonKey: cfg.SUPABASE_ANON_KEY || cfg.supabaseAnonKey || window.SUPABASE_ANON_KEY || ""
    };
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

  // ==========================================================================
  // PENYIMPANAN ID PERANGKAT BERLAPIS (LOCALSTORAGE + COOKIE + INDEXEDDB)
  // ==========================================================================
  function readCookie(name) {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function writeCookie(name, value, days = 365) {
    try {
      const expires = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function syncIndexedDb(deviceId, votedFlag) {
    try {
      if (!window.indexedDB) return;
      const req = indexedDB.open("pasmantab_guard_db", 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction("meta", "readwrite");
        const store = tx.objectStore("meta");
        if (deviceId) store.put(deviceId, DEVICE_KEY);
        if (votedFlag) store.put(votedFlag, VOTED_LOCK_KEY);
      };
    } catch (_) {}
  }

  function restoreFromIndexedDb() {
    return new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve({});
        const req = indexedDB.open("pasmantab_guard_db", 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("meta")) {
            db.createObjectStore("meta");
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("meta", "readonly");
          const store = tx.objectStore("meta");
          const r1 = store.get(DEVICE_KEY);
          const r2 = store.get(VOTED_LOCK_KEY);
          tx.oncomplete = () => {
            resolve({
              deviceId: r1.result || null,
              votedFlag: r2.result || null
            });
          };
          tx.onerror = () => resolve({});
        };
        req.onerror = () => resolve({});
      } catch (_) {
        resolve({});
      }
    });
  }

  function getOrCreateDeviceId() {
    let existing = null;
    try {
      existing =
        localStorage.getItem(DEVICE_KEY) ||
        readCookie(DEVICE_KEY) ||
        localStorage.getItem("pasmantab_device_id");
    } catch (_) {
      existing = readCookie(DEVICE_KEY);
    }

    if (!existing) {
      const randomPart =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      existing = `HW:${randomPart}`;
    }

    try {
      localStorage.setItem(DEVICE_KEY, existing);
    } catch (_) {}
    writeCookie(DEVICE_KEY, existing, 365);
    syncIndexedDb(existing, null);

    return existing;
  }

  function isDeviceLocallyLocked() {
    try {
      if (localStorage.getItem(VOTED_LOCK_KEY) === "1") return true;
    } catch (_) {}
    if (readCookie(VOTED_LOCK_KEY) === "1") return true;
    return false;
  }

  function markDeviceLocallyVoted(deviceId) {
    try {
      localStorage.setItem(VOTED_LOCK_KEY, "1");
      if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId);
    } catch (_) {}
    writeCookie(VOTED_LOCK_KEY, "1", 365);
    if (deviceId) writeCookie(DEVICE_KEY, deviceId, 365);
    syncIndexedDb(deviceId, "1");
  }

  // Pulihkan dari IndexedDB jika cache/cookie sempat dibersihkan
  restoreFromIndexedDb().then((saved) => {
    if (saved.deviceId) {
      try {
        localStorage.setItem(DEVICE_KEY, saved.deviceId);
      } catch (_) {}
      writeCookie(DEVICE_KEY, saved.deviceId, 365);
    }
    if (saved.votedFlag === "1") {
      markDeviceLocallyVoted(saved.deviceId || getOrCreateDeviceId());
    }
  });

  // Pastikan PasmantabUtils selalu memakai ID perangkat yang sama
  if (window.PasmantabUtils) {
    window.PasmantabUtils.getDeviceId = getOrCreateDeviceId;
  }

  // ==========================================================================
  // PEMETAAN PESAN ERROR RAMAH PENGGUNA
  // ==========================================================================
  function mapFriendlyError(err) {
    console.error("[PASMANTAB SYSTEM DETAIL]:", err);

    const raw = String(
      (err && (err.message || err.error_description || err.details)) || err || ""
    ).toUpperCase();

    if (raw.includes("DEVICE_ALREADY_VOTED")) {
      return "Perangkat (HP/Laptop) ini sudah digunakan untuk memberikan suara. Satu perangkat hanya berlaku untuk satu pemilih dan tidak dapat dipakai ulang dengan nama lain.";
    }
    if (raw.includes("ALREADY_VOTED") || raw.includes("VOTER_ALREADY_VOTED")) {
      return "Identitas Anda (nama & kelas) tercatat sudah menggunakan hak suara sebelumnya.";
    }
    if (raw.includes("INVALID_DEVICE_ID")) {
      return "Identitas perangkat tidak terbaca. Nonaktifkan mode penyamaran (Incognito) dan muat ulang halaman.";
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
    const resolvedDevice =
      (arg1 && typeof arg1 === "object"
        ? arg1.p_device_id || arg1.deviceId || arg1.device_id
        : deviceId) || getOrCreateDeviceId();

    if (arg1 && typeof arg1 === "object") {
      return {
        p_full_name:
          arg1.p_full_name || arg1.fullName || arg1.full_name || arg1.voterName || arg1.name || "",
        p_class_name:
          arg1.p_class_name || arg1.className || arg1.class_name || arg1.voterClass || arg1.kelas || "",
        p_raw_token:
          arg1.p_raw_token || arg1.rawToken || arg1.raw_token || arg1.token || arg1.tokenCode || "",
        p_device_id: resolvedDevice
      };
    }
    return {
      p_full_name: arg1 || "",
      p_class_name: className || "",
      p_raw_token: rawToken || "",
      p_device_id: resolvedDevice
    };
  }

  function normalizeBallotArgs(arg1, className, rawToken, chairpersonId, deviceId) {
    const resolvedDevice =
      (arg1 && typeof arg1 === "object"
        ? arg1.p_device_id || arg1.deviceId || arg1.device_id
        : deviceId) || getOrCreateDeviceId();

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
        p_device_id: resolvedDevice
      };
    }
    return {
      p_full_name: arg1 || "",
      p_class_name: className || "",
      p_raw_token: rawToken || "",
      p_chairperson_id: chairpersonId || null,
      p_device_id: resolvedDevice
    };
  }

  const rpcBridge = {
    getDeviceId: getOrCreateDeviceId,

    async verifyVoterAccess(arg1, className, rawToken, deviceId) {
      if (isDeviceLocallyLocked()) {
        throw new Error("DEVICE_ALREADY_VOTED");
      }

      const client = getClient();
      const params = normalizeVoterArgs(arg1, className, rawToken, deviceId);

      // 1. Cek ke server apakah device_id ini sudah ada di tabel voters
      const { error: devErr } = await client.rpc("check_device_voted", {
        p_device_id: params.p_device_id
      });
      if (devErr) {
        if (String(devErr.message || "").includes("DEVICE_ALREADY_VOTED")) {
          markDeviceLocallyVoted(params.p_device_id);
        }
        throw devErr;
      }

      // 2. Validasi token & identitas pemilih
      const { data, error } = await client.rpc("verify_voter_access", params);
      if (error) {
        if (String(error.message || "").includes("DEVICE_ALREADY_VOTED")) {
          markDeviceLocallyVoted(params.p_device_id);
        }
        throw error;
      }
      return data || { ok: true };
    },

    async submitBallotAtomic(arg1, className, rawToken, chairpersonId, deviceId) {
      if (isSubmittingBallot) {
        throw new Error("SUBMISSION_IN_PROGRESS");
      }
      if (isDeviceLocallyLocked()) {
        throw new Error("DEVICE_ALREADY_VOTED");
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
        if (error) {
          if (String(error.message || "").includes("DEVICE_ALREADY_VOTED")) {
            markDeviceLocallyVoted(params.p_device_id);
          }
          throw error;
        }

        // Kunci permanen perangkat setelah suara sah masuk
        markDeviceLocallyVoted(params.p_device_id);
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

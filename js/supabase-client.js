/**
 * PASMANTAB e-VOTING 2026 — Supabase Client Wrapper
 */
(function () {
  const cfg = window.PASMANTAB_CONFIG || {};

  function isConfigured() {
    return (
      cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
      !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")
    );
  }

  let supabaseInstance = null;

  function getSupabase() {
    if (!isConfigured()) {
      throw new Error(
        "CONFIG_MISSING: Lengkapi SUPABASE_URL dan SUPABASE_ANON_KEY pada file js/config.js."
      );
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Library Supabase gagal dimuat. Periksa koneksi internet Anda.");
    }
    if (!supabaseInstance) {
      supabaseInstance = window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true
          }
        }
      );
    }
    return supabaseInstance;
  }

  function mapFriendlyError(err) {
    console.error("[PASMANTAB SYSTEM DETAIL]:", err);

    const raw = (err && (err.message || err.details || String(err))) || "";
    const msg = raw.toUpperCase();

    if (msg.includes("DEVICE_ALREADY_VOTED")) {
      return "Perangkat ini sudah digunakan untuk memberikan suara (1 Perangkat = 1 Suara). Silakan gunakan perangkat pribadi Anda.";
    }
    if (msg.includes("INVALID_IDENTITY_INPUT")) {
      return "Masukkan Nama Lengkap dan Kelas Anda dengan benar.";
    }
    if (msg.includes("OFFLINE_DEVICE")) {
      return "Perangkat Anda sedang offline. Sambungkan internet lalu coba kembali.";
    }
    if (msg.includes("RATE_LIMIT_EXCEEDED")) {
      return "Terlalu banyak percobaan gagal. Tunggu 5 menit sebelum mencoba kembali.";
    }
    if (msg.includes("BALLOTS_ARE_IMMUTABLE") || msg.includes("AUDIT_LOGS_ARE_IMMUTABLE")) {
      return "Data kotak suara bersifat permanen dan tidak dapat diubah.";
    }
    if (msg.includes("ELECTION_NOT_OPEN")) {
      return "Pemilihan belum dibuka atau sudah ditutup oleh panitia.";
    }
    if (msg.includes("INVALID_OR_EXPIRED_TOKEN")) {
      return "Kode Token tidak valid, sudah dicabut, atau telah kedaluwarsa.";
    }
    if (msg.includes("MEMBER_INELIGIBLE")) {
      return "Status keanggotaan Anda tidak memenuhi syarat untuk memilih.";
    }
    if (msg.includes("ALREADY_VOTED")) {
      return "Nama dan Kelas ini sudah tercatat menggunakan hak suaranya sebelumnya (1 Anggota = 1 Suara).";
    }
    if (msg.includes("INVALID_CANDIDATE")) {
      return "Kandidat yang dipilih tidak valid atau sudah dinonaktifkan.";
    }
    if (msg.includes("UNAUTHORIZED_ADMIN") || msg.includes("PGRST116")) {
      return "Akses ditolak. Akun Anda belum terdaftar aktif pada tabel admin_users.";
    }
    if (msg.includes("FAILED TO FETCH") || msg.includes("NETWORK") || msg.includes("TIMEOUT")) {
      return "Koneksi internet terputus atau lambat. Periksa jaringan Anda dan coba kembali.";
    }
    return "Terjadi gangguan pada sistem. Silakan coba beberapa saat lagi atau hubungi panitia.";
  }

  window.SupabaseService = {
    isConfigured,
    getClient: getSupabase,
    mapFriendlyError
  };
  // Jembatan RPC pengiriman surat suara atomik (Tahap 3)
if (window.SupabaseService) {
  window.SupabaseService.rpc = Object.assign(window.SupabaseService.rpc || {}, {
    async submitBallotAtomic(payload = {}) {
      const client = window.SupabaseService.getClient();
      const { data, error } = await client.rpc("cast_ballot_atomic", {
        p_full_name: payload.p_full_name || payload.fullName || payload.full_name,
        p_class_name: payload.p_class_name || payload.className || payload.class_name,
        p_raw_token: payload.p_raw_token || payload.rawToken || payload.raw_token,
        p_chairperson_id:
          payload.p_chairperson_id || payload.chairpersonId || payload.chairperson_id,
        p_device_id: payload.p_device_id || payload.deviceId || payload.device_id || null
      });
      if (error) throw error;
      return data || { ok: true };
    }
  });
}
})();

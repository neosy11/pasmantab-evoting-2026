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
        "CONFIG_MISSING: Lengkapi SUPABASE_URL dan SUPABASE_ANON_KEY pada file js/config.js lalu simpan (Ctrl+S)."
      );
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error(
        "Library Supabase gagal dimuat. Periksa koneksi internet Anda lalu muat ulang halaman."
      );
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

    if (msg.includes("OFFLINE_DEVICE")) {
      return "Perangkat Anda sedang offline (tidak terhubung ke internet). Sambungkan jaringan lalu coba kembali.";
    }
    if (msg.includes("RATE_LIMIT_EXCEEDED")) {
      return "Terlalu banyak percobaan verifikasi yang gagal. Demi keamanan, tunggu 5 menit sebelum mencoba kembali.";
    }
    if (msg.includes("BALLOTS_ARE_IMMUTABLE")) {
      return "Kotak suara bersifat permanen dan tidak dapat diubah atau dihapus.";
    }
    if (msg.includes("AUDIT_LOGS_ARE_IMMUTABLE")) {
      return "Catatan audit bersifat permanen dan tidak dapat diubah atau dihapus.";
    }
    if (msg.includes("CONFIG_MISSING")) {
      return "Konfigurasi Supabase di file js/config.js belum diisi atau belum disimpan.";
    }
    if (msg.includes("EMAIL NOT CONFIRMED")) {
      return "Email panitia belum dikonfirmasi di Supabase Authentication.";
    }
    if (msg.includes("ELECTION_NOT_OPEN")) {
      return "Pemilihan belum dibuka atau sudah ditutup oleh panitia.";
    }
    if (msg.includes("INVALID_OR_EXPIRED_TOKEN")) {
      return "Token pemilihan tidak valid, sudah dicabut, atau telah kedaluwarsa.";
    }
    if (msg.includes("MEMBER_NOT_FOUND")) {
      return "Kombinasi Nama Lengkap dan Kelas tidak ditemukan dalam Daftar Pemilih Tetap (DPT).";
    }
    if (msg.includes("MEMBER_INELIGIBLE")) {
      return "Status keanggotaan Anda tidak memenuhi syarat untuk memilih. Hubungi panitia.";
    }
    if (msg.includes("ALREADY_VOTED")) {
      return "Hak suara untuk anggota dengan Nama dan Kelas ini sudah digunakan sebelumnya (1 Anggota = 1 Suara).";
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
})();
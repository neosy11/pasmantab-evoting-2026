/**
 * PASMANTAB e-VOTING 2026 — Shared Utilities
 */
window.PasmantabUtils = (function () {
  const STORAGE_KEY =
    (window.PASMANTAB_CONFIG && window.PASMANTAB_CONFIG.SESSION_STORAGE_KEY) ||
    "pasmantab_voter_ballot_draft";

  /**
   * Sanitasi string sebelum dirender ke innerHTML (Anti-XSS)
   */
  function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Normalisasi input token atau NIS (hapus spasi berlebih, huruf kapital)
   */
  function normalizeCode(code) {
    return String(code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  /**
   * Manajemen Sesi Pemilih Sementara di Tab Browser (sessionStorage)
   */
  function getVoterDraft() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveVoterDraft(partialData) {
    const current = getVoterDraft() || {};
    const updated = Object.assign({}, current, partialData);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  function clearVoterDraft() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Format tanggal & jam ke zona waktu Indonesia (WITA / lokal browser)
   */
  function formatDateTime(isoString) {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  /**
   * Menampilkan pesan alert pada elemen container target
   */
  function showAlert(containerId, type, message) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.add("hidden");
    el.textContent = "";
  }

  return {
    escapeHTML,
    normalizeCode,
    getVoterDraft,
    saveVoterDraft,
    clearVoterDraft,
    formatDateTime,
    showAlert,
    hideAlert
  };
})();
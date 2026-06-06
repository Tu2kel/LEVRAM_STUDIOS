/**
 * LEVRAM Studios — global API config
 *
 * All pages import this first. BASE_URL resolves to:
 *   1. localStorage "levram-api-url"  (set by launch.html when user saves Railway URL)
 *   2. http://127.0.0.1:8000          (local dev fallback)
 *
 * Usage in any page:
 *   const BASE = window.LEVRAM_CONFIG.api;
 */
(function () {
  const stored = (localStorage.getItem("levram-api-url") || "").trim().replace(/\/$/, "");
  window.LEVRAM_CONFIG = {
    api: stored || "http://127.0.0.1:8000",
  };
})();

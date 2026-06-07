/**
 * LEVRAM Studios — global API config
 *
 * Resolves BASE URL in priority order:
 *   1. localStorage "levram-api-url"  (manually saved Railway URL)
 *   2. window.location.origin         (if already on Railway / non-localhost)
 *   3. http://127.0.0.1:8000          (local dev fallback)
 */
(function () {
  const stored = (localStorage.getItem("levram-api-url") || "").trim().replace(/\/$/, "");
  const isLocal = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  window.LEVRAM_CONFIG = {
    api: stored || (isLocal ? "http://127.0.0.1:8000" : window.location.origin),
  };
})();

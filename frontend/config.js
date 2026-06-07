/**
 * LEVRAM Studios — global API config
 *
 * Resolves BASE URL in priority order:
 *   1. localStorage "levram-api-url" — only if not a localhost value on a remote host
 *   2. window.location.origin        — if accessed from Railway / custom domain
 *   3. http://127.0.0.1:8000         — local dev fallback
 */
(function () {
  const stored      = (localStorage.getItem("levram-api-url") || "").trim().replace(/\/$/, "");
  const isLocal     = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  const storedLocal = stored.includes("127.0.0.1") || stored.includes("localhost");
  const useStored   = stored && !(storedLocal && !isLocal);
  window.LEVRAM_CONFIG = {
    api: useStored ? stored : (isLocal ? "http://127.0.0.1:8000" : window.location.origin),
  };
})();

/**
 * LEVRAM Studios — global API config
 *
 * Resolves BASE URL in priority order:
 *   1. localStorage "levram-api-url" — only if not a localhost value on a remote host
 *   2. window.location.origin        — if accessed from Railway / custom domain
 *   3. http://127.0.0.1:8000         — local dev fallback
 *
 * Auth:
 *   If LEVRAM_PASSWORD is set on the server, store the password in
 *   localStorage "levram-password". All API calls must send:
 *     Authorization: Bearer <password>
 *   Use window.levFetch() as a drop-in for fetch() — it adds the header automatically.
 */
(function () {
  const stored      = (localStorage.getItem("levram-api-url") || "").trim().replace(/\/$/, "");
  const isLocal     = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
  const storedLocal = stored.includes("127.0.0.1") || stored.includes("localhost");
  const useStored   = stored && !(storedLocal && !isLocal);

  window.LEVRAM_CONFIG = {
    api: useStored ? stored : (isLocal ? "http://127.0.0.1:8000" : window.location.origin),
  };

  // Authenticated fetch — identical signature to fetch() but injects Bearer token
  window.levFetch = async function (url, opts = {}) {
    const pw = (localStorage.getItem("levram-password") || "").trim();
    if (pw) {
      opts.headers = Object.assign({}, opts.headers || {}, {
        "Authorization": "Bearer " + pw,
      });
    }
    try {
      const res = await fetch(url, opts);
      if (res.status === 401) {
        levShowError("Session expired or wrong password — re-enter it in Settings.");
      }
      return res;
    } catch (err) {
      const isTimeout = err.name === "AbortError";
      if (!isTimeout) {
        levShowError(`Cannot reach server: ${err.message}`);
      }
      throw err;
    }
  };

  // Transient error banner — auto-dismisses after 6s, dedupes identical messages
  let _levErrTimer = null;
  window.levShowError = function (msg) {
    let banner = document.getElementById("lev-err-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "lev-err-banner";
      banner.style.cssText = [
        "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
        "background:linear-gradient(90deg,#7a0000,#cc2200)",
        "color:#fff", "font-family:Rajdhani,sans-serif",
        "font-size:13px", "letter-spacing:2px", "text-transform:uppercase",
        "padding:8px 48px 8px 16px", "cursor:pointer",
        "box-shadow:0 2px 12px rgba(0,0,0,0.6)"
      ].join(";");
      banner.onclick = () => { banner.style.display = "none"; };
      document.body.appendChild(banner);
    }
    if (banner.textContent === msg && banner.style.display !== "none") return;
    banner.textContent = msg;
    banner.style.display = "block";
    clearTimeout(_levErrTimer);
    _levErrTimer = setTimeout(() => { banner.style.display = "none"; }, 6000);
  };
  // ── Job poller — polls /video/job/{id} every 3s, calls callbacks on state change
  // Usage: levPollJob(jobId, baseUrl, { onRunning, onComplete, onFailed, intervalMs })
  window.levPollJob = function(jobId, baseUrl, { onRunning, onComplete, onFailed, intervalMs = 3000 } = {}) {
    const started = Date.now();
    let timer = null;

    async function check() {
      try {
        const res  = await window.levFetch(`${baseUrl}/video/job/${jobId}`);
        const data = await res.json();
        const elapsed = Math.round((Date.now() - started) / 1000);

        if (data.status === "running" && onRunning)  onRunning(elapsed);
        if (data.status === "queued"  && onRunning)  onRunning(elapsed);

        if (data.status === "complete") {
          clearInterval(timer);
          if (onComplete) onComplete(data.result, elapsed);
          return;
        }
        if (data.status === "failed") {
          clearInterval(timer);
          if (onFailed) onFailed(data.error || "Generation failed");
          return;
        }
      } catch(e) {
        // network blip — keep polling
      }
    }

    check();
    timer = setInterval(check, intervalMs);
    return () => clearInterval(timer); // returns cancel fn
  };
})();

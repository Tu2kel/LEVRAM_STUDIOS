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

  // Authenticated fetch — identical signature to fetch() but injects Bearer token + studio header
  window.levFetch = async function (url, opts = {}) {
    const pw     = (localStorage.getItem("levram-password") || "").trim();
    const studio = (window.RL && window.RL.isActive()) ? "redlight" : "levram";
    opts.headers = Object.assign({ "X-Studio": studio }, opts.headers || {});
    if (pw) {
      opts.headers["Authorization"] = "Bearer " + pw;
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
  // ── Service error banner ──────────────────────────────────────────────────
  window.levShowServiceError = function(msg, onRetry) {
    let banner = document.getElementById("lev-service-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "lev-service-banner";
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div class="lsb-title">⚠ Service Error</div>
      <div>${msg}</div>
      ${onRetry ? '<div class="lsb-retry" id="lsb-retry-btn">Retry</div>' : ''}
      <div style="position:absolute;top:6px;right:10px;font-size:16px;cursor:pointer;color:#888;" onclick="this.closest('#lev-service-banner').style.display='none'">✕</div>
    `;
    banner.style.display = "block";
    if (onRetry) {
      const btn = banner.querySelector("#lsb-retry-btn");
      if (btn) btn.onclick = (e) => { e.stopPropagation(); banner.style.display="none"; onRetry(); };
    }
    banner.onclick = () => { banner.style.display = "none"; };
  };

  // ── Job poller ────────────────────────────────────────────────────────────
  // Polls /video/job/{id} every 3s.
  // - Tolerates up to 8 consecutive network blips before giving up (~24s outage)
  // - Treats jobs still "running" after 20 min as failed (fal.ai stuck)
  // - Surfaces retry button via levShowServiceError on terminal failure
  window.levPollJob = function(jobId, baseUrl, { onRunning, onComplete, onFailed, intervalMs = 3000 } = {}) {
    const started      = Date.now();
    const MAX_NETWORK  = 8;     // consecutive network failures before giving up
    const MAX_RUNTIME  = 1200;  // seconds — 20 min hard cap
    let timer          = null;
    let networkFails   = 0;

    function abort(msg) {
      clearInterval(timer);
      window.levShowServiceError(msg, () => {
        // Retry: restart the whole poll
        window.levPollJob(jobId, baseUrl, { onRunning, onComplete, onFailed, intervalMs });
      });
      if (onFailed) onFailed(msg);
    }

    async function check() {
      const elapsed = Math.round((Date.now() - started) / 1000);

      if (elapsed > MAX_RUNTIME) {
        abort(`Generation timed out after ${MAX_RUNTIME / 60} min — fal.ai may be overloaded. Retry?`);
        return;
      }

      try {
        const res  = await window.levFetch(`${baseUrl}/video/job/${jobId}`);
        const data = await res.json();
        networkFails = 0; // reset on success

        if (data.status === "queued"  && onRunning) onRunning(elapsed);
        if (data.status === "running" && onRunning) onRunning(elapsed);

        if (data.status === "complete") {
          clearInterval(timer);
          if (onComplete) onComplete(data.result, elapsed);
          return;
        }
        if (data.status === "failed") {
          clearInterval(timer);
          const errMsg = data.error || "Generation failed";
          window.levShowServiceError(errMsg, () => {
            if (onFailed) onFailed(errMsg);
          });
          if (onFailed) onFailed(errMsg);
          return;
        }
      } catch(e) {
        networkFails++;
        if (networkFails >= MAX_NETWORK) {
          abort(`Lost connection to server after ${networkFails} retries. Check your network or Railway status.`);
        }
        // else: silent — keep polling through brief blips
      }
    }

    check();
    timer = setInterval(check, intervalMs);
    return () => clearInterval(timer);
  };
})();

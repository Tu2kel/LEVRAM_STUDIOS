/**
 * LEVRAM Backend Console
 * Powers the nav heartbeat pill + collapsible log drawer.
 * Exposed as window.BC so any module can call BC.log() or BC.watchJob().
 */

window.BC = (() => {
  const MAX_LINES  = 300;
  const POLL_MS    = 5000;
  const JOB_POLL_MS = 4000;

  let _lines    = [];
  let _hbTimer  = null;
  let _jobTimer = null;
  let _jobId    = null;
  let _open     = false;

  // ── DOM refs ───────────────────────────────────────────────
  const $dot    = () => document.getElementById("backend-status-dot");
  const $text   = () => document.getElementById("backend-status-text");
  const $drawer = () => document.getElementById("bc-drawer");
  const $feed   = () => document.getElementById("bc-feed");
  const $badge  = () => document.getElementById("bc-badge");
  const $toggle = () => document.getElementById("bc-toggle-btn");

  // ── Helpers ────────────────────────────────────────────────
  function _ts() {
    return new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  function _base() {
    return window.LEVRAM_CONFIG?.api || "http://localhost:8000";
  }

  function _authHeaders() {
    const token = localStorage.getItem("levram_token") || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // ── Dot state ──────────────────────────────────────────────
  function _dot(state) {
    const d = $dot();
    if (!d) return;
    const map = {
      ok:   ["#2ecc71", "pulse 2s infinite"],
      busy: ["var(--gold,#c9a84c)", "pulse 0.6s infinite"],
      warn: ["#f39c12", "pulse 1s infinite"],
      err:  ["#e74c3c", "none"],
    };
    const [color, anim] = map[state] || map.ok;
    d.style.background = color;
    d.style.boxShadow  = `0 0 8px ${color}`;
    d.style.animation  = anim;
  }

  // ── Log line ───────────────────────────────────────────────
  const TYPE_META = {
    info:    { icon: "·",  color: "rgba(255,255,255,0.45)" },
    success: { icon: "✔",  color: "#2ecc71" },
    warn:    { icon: "⚠",  color: "#f39c12" },
    error:   { icon: "✖",  color: "#e74c3c" },
    step:    { icon: "↻",  color: "#c9a84c" },
  };

  function log(msg, type = "info") {
    if (!msg) return;
    const meta = TYPE_META[type] || TYPE_META.info;
    _lines.push({ ts: _ts(), msg, type });
    if (_lines.length > MAX_LINES) _lines.shift();

    const f = $feed();
    if (f) {
      const row = document.createElement("div");
      row.className = "bc-row";
      row.innerHTML =
        `<span class="bc-ts">${_ts()}</span>` +
        `<span class="bc-icon" style="color:${meta.color}">${meta.icon}</span>` +
        `<span class="bc-msg" style="color:${meta.color}">${_esc(msg)}</span>`;
      f.appendChild(row);
      f.scrollTop = f.scrollHeight;
    }

    // Errors auto-bump badge and update pill
    if (type === "error" || type === "step" || type === "success") {
      const t = $text();
      if (t) t.textContent = msg.length > 48 ? msg.slice(0, 48) + "…" : msg;
    }
    if (!_open && (type === "error" || type === "warn")) {
      const b = $badge();
      if (b) {
        const n = parseInt(b.dataset.n || "0") + 1;
        b.dataset.n      = n;
        b.textContent    = n;
        b.style.display  = "inline-flex";
      }
    }
    // Auto-open drawer on errors
    if (type === "error" && !_open) toggle();
  }

  function _esc(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ── Heartbeat ──────────────────────────────────────────────
  let _offlineSince = null;
  let _lastOfflineLog = 0;

  async function _heartbeat() {
    try {
      const r = await fetch(`${_base()}/settings/status`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        if (_offlineSince) {
          const secs = Math.round((Date.now() - _offlineSince) / 1000);
          log(`Backend back online (was down ${secs}s)`, "success");
          _offlineSince = null;
        }
        _dot(_jobId ? "busy" : "ok");
        const t = $text();
        if (t && !_jobId) t.textContent = "Backend Live";
      } else {
        _dot("warn");
        log(`Backend ${r.status} ${r.statusText}`, "warn");
      }
    } catch (e) {
      _dot("err");
      const t = $text();
      if (t) t.textContent = "OFFLINE";
      const now = Date.now();
      if (!_offlineSince) {
        _offlineSince = now;
        log("Backend unreachable — " + e.message, "error");
      } else if (now - _lastOfflineLog > 30000) {
        // Only re-log every 30s while offline, not every 5s
        const secs = Math.round((now - _offlineSince) / 1000);
        log(`Still offline — ${secs}s (check Railway dashboard)`, "warn");
        _lastOfflineLog = now;
      }
    }
  }

  // ── Job watcher ────────────────────────────────────────────
  function watchJob(jobId, label) {
    if (_jobTimer) clearInterval(_jobTimer);
    _jobId = jobId;
    _dot("busy");
    log(`▶ Job started${label ? " — " + label : ""}  [${jobId.slice(0,8)}]`, "step");

    let _lastStep = "";
    const _seenErrors = new Set();

    _jobTimer = setInterval(async () => {
      try {
        const r = await fetch(`${_base()}/orchestrate/status/${jobId}`, {
          headers: _authHeaders(),
        });
        if (!r.ok) { log(`Job poll ${r.status}`, "warn"); return; }
        const d = await r.json();

        // Only log new steps
        if (d.step && d.step !== _lastStep) {
          _lastStep = d.step;
          const t = d.status === "failed" ? "error" : "step";
          log(d.step, t);
        }

        // Surface accumulated per-shot errors
        if (Array.isArray(d.errors)) {
          d.errors.forEach(e => {
            if (!_seenErrors.has(e)) { _seenErrors.add(e); log(e, "error"); }
          });
        }

        if (d.error && d.status !== "failed") log("Error: " + d.error, "error");

        if (d.status === "complete" || d.status === "keyframes_ready") {
          clearInterval(_jobTimer); _jobTimer = null; _jobId = null;
          _dot("ok");
          const t = $text(); if (t) t.textContent = "Backend Live";
          log(`✔ Job complete — ${d.shots?.length || 0} shots in timeline`, "success");
        } else if (d.status === "failed") {
          clearInterval(_jobTimer); _jobTimer = null; _jobId = null;
          _dot("err");
          log("✖ Job FAILED: " + (d.error || "unknown error"), "error");
        }
      } catch (e) {
        log("Job poll error: " + e.message, "error");
      }
    }, JOB_POLL_MS);
  }

  // ── Toggle drawer ──────────────────────────────────────────
  function toggle() {
    _open = !_open;
    const d = $drawer();
    const b = $toggle();
    if (d) d.classList.toggle("bc-open", _open);
    if (b) b.innerHTML = (_open ? "▼" : "▲") + ' Console' +
      `<span id="bc-badge" data-n="${$badge()?.dataset?.n||0}" style="display:${_open?"none":"inline-flex"}">${$badge()?.textContent||""}</span>`;
    if (_open) {
      const badge = $badge();
      if (badge) { badge.style.display = "none"; badge.dataset.n = "0"; }
      const f = $feed(); if (f) f.scrollTop = f.scrollHeight;
    }
  }

  function clear() {
    _lines = [];
    const f = $feed(); if (f) f.innerHTML = "";
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    _heartbeat();
    _hbTimer = setInterval(_heartbeat, POLL_MS);
    log("LEVRAM Studio online", "success");
  }

  return { log, watchJob, toggle, clear, init };
})();

document.addEventListener("DOMContentLoaded", () => BC.init());

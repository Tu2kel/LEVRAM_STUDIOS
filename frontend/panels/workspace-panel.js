// ws-preview
document.getElementById("ws-preview").innerHTML = `
  <div class="panel-header" style="padding:8px 20px;flex-shrink:0">
    <div class="panel-header-icon gold">
      <svg viewBox="0 0 16 16" fill="black"><path d="M3 3h10v10H3z" /></svg>
    </div>
    <span class="panel-title">Preview / Generated Output</span>
    <div style="margin-left:auto;display:flex;gap:8px">
      <a id="dl-raw" download
        style="background:transparent;border:1px solid var(--border);color:var(--text-muted);font-family:Rajdhani,sans-serif;font-size:18px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;text-decoration:none;display:inline-block;">
        Download Raw
      </a>
      <a id="dl-fx" download
        style="background:transparent;border:1px solid var(--border-strong);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:18px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;text-decoration:none;display:inline-block;">
        Download FX
      </a>
    </div>
  </div>
  <div class="preview-inner" style="flex:1;min-height:0;display:flex;overflow:hidden">
    <div id="preview-main" class="preview-main">
      <div class="preview-placeholder">
        <span class="big-icon">&#9654;</span>
        <p>No output yet — generate voice or build shot</p>
      </div>
    </div>
    <div class="preview-meta">
      <div class="meta-item"><span class="meta-label">Shot</span><span id="meta-shot-num" class="meta-val gold">—</span></div>
      <div class="meta-item"><span class="meta-label">Character</span><span id="meta-char" class="meta-val gold">—</span></div>
      <div class="meta-item"><span class="meta-label">Preset</span><span id="meta-preset" class="meta-val">—</span></div>
      <div class="meta-item"><span class="meta-label">Engine</span><span id="meta-engine" class="meta-val">Spark-TTS</span></div>
      <div class="meta-item"><span class="meta-label">FX Status</span><span id="meta-fx-status" class="meta-val red">Pending</span></div>
      <div class="meta-item"><span class="meta-label">Duration</span><span id="meta-duration" class="meta-val">—</span></div>
      <div class="meta-item"><span class="meta-label">Project</span><span id="meta-project" class="meta-val blue">—</span></div>
      <div class="meta-item"><span class="meta-label">Keyframe</span><span id="meta-keyframe-status" class="meta-val">—</span></div>
      <div class="meta-item"><span class="meta-label">Clip</span><span id="meta-clip-status" class="meta-val">—</span></div>
    </div>
  </div>
  <div id="preview-media-row" style="display:none;flex-shrink:0;padding:8px 20px 6px;border-top:1px solid rgba(201,168,76,0.08);background:rgba(0,0,0,0.25);">
    <div style="display:flex;gap:12px;align-items:flex-start;">
      <img id="preview-keyframe" style="display:none;height:110px;max-width:150px;border-radius:4px;object-fit:contain;border:1px solid rgba(201,168,76,0.25);flex-shrink:0;" alt="Keyframe" />
      <video id="preview-clip" style="display:none;height:110px;max-width:180px;border-radius:4px;flex-shrink:0;" controls muted loop playsinline></video>
      <div style="flex:1;min-width:0;">
        <div id="preview-shot-num" style="font-size:9px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;"></div>
        <div id="preview-shot-desc" style="font-size:11px;color:rgba(255,255,255,0.6);line-height:1.5;max-height:50px;overflow:hidden;margin-bottom:4px;"></div>
        <div id="preview-shot-dialogue" style="font-size:12px;color:var(--gold);font-style:italic;line-height:1.4;max-height:40px;overflow:hidden;"></div>
        <div id="preview-shot-actions" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;"></div>
      </div>
    </div>
  </div>
  <div id="waveform-area" class="waveform-area" style="flex-shrink:0">
    <span style="font-size:17px;letter-spacing:3px;text-transform:uppercase;color:var(--text-dim);font-weight:600;margin-right:12px;white-space:nowrap;">Waveform</span>
  </div>
`;

// ws-timeline
document.getElementById("ws-timeline").innerHTML = `
  <div class="timeline-header character-lab-header" style="flex-shrink:0">
    <span class="panel-title" style="font-size:20px;letter-spacing:5px">Shot History / Timeline</span>
    <div style="display:flex;gap:8px;margin-left:16px">
      <button id="btn-clear" class="ws-ctrl-btn">Clear</button>
      <button id="btn-save-timeline-order" class="ws-ctrl-btn gold">Save Order</button>
      <button id="btn-export-timeline" class="ws-ctrl-btn"
        style="background:linear-gradient(90deg,rgba(139,105,20,0.5),rgba(201,168,76,0.5));border-color:rgba(201,168,76,0.6);color:var(--gold);">
        &#11015; Export Final Video
      </button>
    </div>
    <span id="tl-time" class="tl-time">00:00:00 / 00:00:00</span>
  </div>
  <div class="timeline-tracks" style="flex-shrink:0">
    <div class="track"><span class="track-label">Voice</span><div id="track-voice-body" class="track-body"></div></div>
    <div class="track"><span class="track-label">FX</span><div id="track-fx-body" class="track-body"></div></div>
    <div class="track"><span class="track-label">Shots</span><div id="track-shot-body" class="track-body"></div></div>
  </div>
  <div id="timeline-shots"
    style="flex:1 1 0;min-height:0;overflow-y:scroll;padding:12px 20px 32px;display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(201,168,76,0.08);">
  </div>
`;

// ws-character
document.getElementById("ws-character").innerHTML = `
  <div class="timeline-header" style="flex-shrink:0">
    <span class="panel-title" style="font-size:20px;letter-spacing:5px">Character Lab</span>
    <span class="tl-time">Reusable cast profiles</span>
    <div class="character-lab-header-actions">
      <button id="character-lab-collapse-btn" class="character-lab-collapse-btn" type="button" aria-expanded="true">COLLAPSE</button>
    </div>
  </div>
  <div id="character-lab-content"
    style="flex:1 1 0;min-height:0;overflow-y:scroll;padding:12px 20px 32px;display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(201,168,76,0.08);">
  </div>
`;

// Export modal — append to body
(function() {
  const modal = document.createElement("div");
  modal.id = "tl-export-modal";
  modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;align-items:center;justify-content:center;";
  modal.onclick = function(e) { if (e.target === modal) tlCloseExportModal(); };
  modal.innerHTML = `
    <div style="background:#0d0d14;border:1px solid rgba(201,168,76,0.35);border-radius:6px;width:460px;max-width:95vw;padding:24px;font-family:Rajdhani,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <span style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);">&#11015; Export Final Video</span>
        <button onclick="tlCloseExportModal()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;">&#10005;</button>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,0.35);letter-spacing:1px;margin-bottom:16px;">
        <span id="tl-export-clip-count">0</span> animated clips &nbsp;&middot;&nbsp;
        <span id="tl-export-voice-count">0</span> voice tracks
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Title / Filename</div>
          <input id="tl-export-title" value="LEVRAM_Export"
            style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:14px;padding:7px 10px;border-radius:3px;" />
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:3px;">
          <input type="checkbox" id="tl-export-voice-chk" checked style="accent-color:var(--gold);width:14px;height:14px;" />
          <label for="tl-export-voice-chk" style="font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:1px;cursor:pointer;">
            Include voice audio (auto-generated TTS + FX or manual recordings)
          </label>
        </div>
        <div>
          <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Music Track (optional)</div>
          <select id="tl-export-music-sel"
            style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;padding:6px 8px;border-radius:3px;">
            <option value="">None — no music</option>
          </select>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;">Music Volume</span>
            <span id="tl-export-vol-label" style="font-size:11px;color:rgba(255,255,255,0.4);">20%</span>
          </div>
          <input type="range" id="tl-export-music-vol" min="0" max="1" step="0.05" value="0.2"
            oninput="document.getElementById('tl-export-vol-label').textContent=Math.round(this.value*100)+'%'"
            style="width:100%;accent-color:var(--gold);" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Transition</div>
            <select id="tl-export-transition"
              style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;padding:6px 8px;border-radius:3px;">
              <option value="none">None (hard cut)</option>
              <option value="fade">Fade</option>
              <option value="dissolve">Dissolve</option>
              <option value="wipeleft">Wipe Left</option>
              <option value="smoothup">Smooth Up</option>
              <option value="radial">Radial</option>
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Color Grade</div>
            <select id="tl-export-grade"
              style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;padding:6px 8px;border-radius:3px;">
              <option value="">None</option>
              <option value="cinematic">Cinematic</option>
              <option value="warm">Warm</option>
              <option value="cool">Cool</option>
              <option value="noir">Noir (B&amp;W)</option>
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center;">
          <div>
            <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Clip Speed</div>
            <select id="tl-export-speed"
              style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;padding:6px 8px;border-radius:3px;">
              <option value="1.0">Normal (1&times;)</option>
              <option value="0.5">Slow-mo (0.5&times;)</option>
              <option value="0.75">Cinematic (0.75&times;)</option>
              <option value="1.5">Fast (1.5&times;)</option>
              <option value="2.0">2&times; Speed</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:3px;height:fit-content;">
            <input type="checkbox" id="tl-export-captions" style="accent-color:var(--gold);width:14px;height:14px;" />
            <label for="tl-export-captions" style="font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:1px;cursor:pointer;">Burn-in captions</label>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Title Card (optional — prepend to film)</div>
        <input id="tl-export-title-clip" type="text"
          style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:#fff;font-family:Rajdhani,sans-serif;font-size:13px;padding:7px 10px;border-radius:3px;"
          placeholder="/output/videos/my_title_card.mp4 — leave blank to skip" />
      </div>
      <button id="tl-export-run-btn" onclick="tlRunExport()"
        style="width:100%;margin-top:20px;background:linear-gradient(90deg,rgba(139,105,20,0.6),rgba(201,168,76,0.6));border:1px solid rgba(201,168,76,0.6);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:14px;letter-spacing:3px;text-transform:uppercase;padding:10px;border-radius:3px;cursor:pointer;">
        &#11015; Export Final Video
      </button>
      <div id="tl-export-status" style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:1px;min-height:16px;text-align:center;"></div>
      <div id="tl-export-preview" style="display:none;margin-top:16px;border:1px solid rgba(201,168,76,0.3);border-radius:4px;overflow:hidden;background:#000;">
        <video id="tl-export-video" controls style="width:100%;max-height:280px;display:block;"></video>
        <div style="display:flex;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.6);">
          <a id="tl-export-dl-link" href="#" download style="flex:1;text-align:center;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:6px 12px;border-radius:2px;text-decoration:none;">&#11015; Download</a>
          <button onclick="document.getElementById('tl-export-preview').style.display='none'" style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.4);font-size:12px;letter-spacing:1px;padding:6px 10px;cursor:pointer;border-radius:2px;">&#10005;</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
})();

// Workspace switcher
(function () {
  const panels = {
    preview:   document.getElementById("ws-preview"),
    timeline:  document.getElementById("ws-timeline"),
    character: document.getElementById("ws-character"),
  };

  let activeWorkspace = null;

  function hideAll() {
    Object.values(panels).forEach(el => { if (el) el.style.display = "none"; });
    document.querySelectorAll(".workspace-tab-btn").forEach(btn => btn.classList.remove("active"));
    activeWorkspace = null;
  }

  function show(key) {
    if (activeWorkspace === key) { hideAll(); return; }
    Object.entries(panels).forEach(([k, el]) => {
      if (el) {
        el.style.display = k === key ? "flex" : "none";
        if (k === key) {
          el.style.flexDirection = "column";
          el.style.minHeight = k === "character" ? "400px" : "0";
          el.style.overflow = "hidden";
        }
      }
    });
    document.querySelectorAll(".workspace-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.ws === key);
    });
    activeWorkspace = key;
  }

  document.querySelectorAll(".workspace-tab-btn").forEach(btn => {
    if (!btn.dataset.ws) return;
    btn.addEventListener("click", () => show(btn.dataset.ws));
  });

  hideAll();
  window.showWorkspace = show;
  window.hideWorkspace = hideAll;
})();

// Live backend status pill
(function liveStatusPill() {
  const BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";
  const dot  = document.getElementById("backend-status-dot");

  async function ping() {
    try {
      const res = await levFetch(`${BASE}/settings/status`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        if (dot) { dot.style.background = "#4caf50"; dot.style.boxShadow = "0 0 6px #4caf50"; }
      } else throw new Error();
    } catch {
      if (dot) { dot.style.background = "#ef5350"; dot.style.boxShadow = "0 0 6px #ef5350"; }
    }
  }

  ping();
  setInterval(ping, 15000);
})();

document.getElementById("tab-music").innerHTML = `
  <!-- Upload + Generate column -->
  <div style="flex:0 0 300px;">
    <div class="panel-header">
      <div class="panel-header-icon gold">
        <svg viewBox="0 0 16 16" fill="black"><path d="M9 2.5a.5.5 0 0 0-1 0V10a2 2 0 1 0 1 1.73V5h3V2.5H9z"/></svg>
      </div>
      <span class="panel-title">Score Studio</span>
      <span class="panel-badge">Music</span>
    </div>
    <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:14px;margin-bottom:10px;">
      <div class="field-label">Track Name</div>
      <input id="ms-track-name" class="script-input" style="height:auto;padding:8px;margin-bottom:8px;" placeholder="e.g. Main Theme — Dark Orchestral" />
      <div class="field-label">Mood</div>
      <select id="ms-track-mood" class="voice-char-select" style="margin-bottom:8px;">
        <option value="">Unspecified</option>
        <option>Dark Orchestral</option><option>Tragic Cinematic</option>
        <option>Cosmic Ambient</option><option>Action Tension</option>
        <option>Lo-Fi Urban</option><option>Villain Theme</option>
        <option>Hero Collapse</option><option>Electronic Dystopian</option>
      </select>
      <div class="field-label">Audio File (mp3, wav, ogg)</div>
      <input type="file" id="ms-track-file" accept="audio/*" class="script-input" style="height:auto;padding:6px;margin-bottom:6px;" />
      <button class="gen-btn" onclick="msUploadTrack()">Upload Track</button>
      <div id="ms-upload-status" style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;min-height:14px;"></div>
    </div>
    <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:14px;">
      <div class="field-label">AI Score Generation</div>
      <textarea id="ms-ai-prompt" class="script-input" style="height:70px;resize:vertical;" placeholder="Dark cinematic orchestral, villain reveal, deep brass, rising tension, Hans Zimmer style&#8230;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <select id="ms-ai-dur" class="voice-char-select" style="flex:1;">
          <option value="15">15s — Sting</option>
          <option value="30" selected>30s — Scene</option>
          <option value="60">60s — Full</option>
          <option value="90">90s — Episode</option>
        </select>
        <input id="ms-ai-name" class="script-input" style="flex:1;height:auto;padding:7px;" placeholder="Track name" />
      </div>
      <button id="ms-ai-btn" class="gen-btn" style="margin-top:8px;" onclick="msGenerateAI()">Generate AI Score</button>
      <div id="ms-ai-status" style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;min-height:14px;"></div>
      <audio id="ms-ai-preview" controls style="display:none;width:100%;margin-top:8px;"></audio>
    </div>
  </div>

  <!-- Library column -->
  <div style="flex:1;min-width:260px;">
    <div class="panel-header">
      <div class="panel-header-icon blue">
        <svg viewBox="0 0 16 16" fill="white"><path d="M2 3h12v1H2zm0 3h12v1H2zm0 3h8v1H2z"/></svg>
      </div>
      <span class="panel-title">Score Library</span>
      <button onclick="msLoadLibrary()" style="margin-left:auto;background:transparent;border:1px solid rgba(201,168,76,0.25);color:var(--gold);font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:3px 10px;cursor:pointer;border-radius:2px;">Refresh</button>
    </div>
    <div id="ms-track-library" style="display:flex;flex-direction:column;gap:8px;padding:8px 0;">
      <div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">Loading&#8230;</div>
    </div>
  </div>

  <!-- Mix column -->
  <div style="flex:0 0 280px;">
    <div class="panel-header">
      <div class="panel-header-icon gold">
        <svg viewBox="0 0 16 16" fill="black"><path d="M1 8a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 8zm0-4a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 4zm0 8a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 1 12z"/></svg>
      </div>
      <span class="panel-title">Mix into Episode</span>
    </div>
    <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:14px;">
      <div class="field-label">Select Track</div>
      <select id="ms-mix-track" class="voice-char-select" style="margin-bottom:8px;"><option value="">Loading&#8230;</option></select>
      <div class="field-label">Select Episode Video</div>
      <select id="ms-mix-video" class="voice-char-select" style="margin-bottom:8px;"><option value="">Loading&#8230;</option></select>
      <div class="field-label">Music Volume</div>
      <input type="range" id="ms-mix-vol" min="5" max="100" value="25" oninput="document.getElementById('ms-mix-vol-val').textContent=this.value+'%'" style="width:100%;accent-color:var(--gold);" />
      <span id="ms-mix-vol-val" style="font-size:11px;color:var(--text-dim);">25%</span>
      <div class="field-label" style="margin-top:8px;">Fade Out (sec)</div>
      <input type="number" id="ms-mix-fade" class="script-input" value="4" min="1" max="20" style="height:auto;padding:6px;margin-bottom:8px;" />
      <button class="gen-btn" onclick="msMixMusic()">Mix Score into Episode</button>
      <div id="ms-mix-status" style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:6px;min-height:14px;"></div>
      <video id="ms-mix-result" controls style="display:none;width:100%;margin-top:8px;border-radius:4px;background:#000;max-height:160px;"></video>
    </div>
  </div>
`;

// Music Studio logic — separate IIFE to avoid nested template literal issues
(function () {
  const MS_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";
  let _msTracks = [];

  async function msLoadLibrary() {
    const el  = document.getElementById("ms-track-library");
    const sel = document.getElementById("ms-mix-track");
    try {
      const res  = await levFetch(`${MS_BASE}/music/library`);
      const data = await res.json();
      _msTracks  = data.tracks || [];
      if (el) {
        el.innerHTML = _msTracks.length
          ? _msTracks.map(t => `
              <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.12);border-radius:3px;padding:8px 10px;">
                <div style="font-size:12px;color:#e8d7a0;font-weight:600;">${t.name || t.filename}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-bottom:6px;">${t.mood || ""}${t.project ? " · " + t.project : ""}</div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                  ${t.url ? `<audio controls src="${MS_BASE}${t.url}" style="height:24px;flex:1;min-width:100px;"></audio>` : ""}
                  <button onclick="msCopyUrl('${t.url}')" style="background:transparent;border:1px solid rgba(201,168,76,0.25);color:var(--gold);font-size:9px;letter-spacing:1px;padding:2px 7px;cursor:pointer;border-radius:2px;">Copy URL</button>
                  <button onclick="msDeleteTrack('${t.id}')" style="background:transparent;border:1px solid rgba(200,0,0,0.3);color:#ef5350;font-size:9px;letter-spacing:1px;padding:2px 7px;cursor:pointer;border-radius:2px;">Delete</button>
                </div>
              </div>`).join("")
          : `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No tracks yet.</div>`;
      }
      if (sel) {
        sel.innerHTML = `<option value="">None</option>` + _msTracks.map(t => `<option value="${t.url}">${t.name || t.filename}</option>`).join("");
      }
      const expSel = document.getElementById("tl-export-music-sel");
      if (expSel) {
        expSel.innerHTML = `<option value="">None — no music</option>` + _msTracks.map(t => `<option value="${t.url}">${t.name || t.filename}</option>`).join("");
      }
    } catch (e) {
      if (el) el.innerHTML = `<div style="color:var(--imperial-red);font-size:11px;">Could not load tracks.</div>`;
    }
  }
  window.msLoadLibrary = msLoadLibrary;

  async function msLoadVideos() {
    const sel = document.getElementById("ms-mix-video");
    try {
      const res  = await levFetch(`${MS_BASE}/video/library`);
      const data = await res.json();
      const vids = data.videos || [];
      if (sel) {
        sel.innerHTML = `<option value="">Select video…</option>` + vids.map(v => `<option value="${v.url}">${v.name || v.filename}</option>`).join("");
      }
    } catch (_) {}
  }

  window.msUploadTrack = async function msUploadTrack() {
    const name     = document.getElementById("ms-track-name")?.value.trim() || "";
    const mood     = document.getElementById("ms-track-mood")?.value || "";
    const fileEl   = document.getElementById("ms-track-file");
    const statusEl = document.getElementById("ms-upload-status");
    if (!fileEl?.files?.length) { if (statusEl) statusEl.textContent = "Select an audio file."; return; }
    const fd = new FormData();
    fd.append("file", fileEl.files[0]);
    fd.append("name", name || fileEl.files[0].name);
    fd.append("mood", mood);
    if (statusEl) statusEl.textContent = "Uploading…";
    try {
      const res  = await levFetch(`${MS_BASE}/music/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || "Upload failed");
      if (statusEl) statusEl.textContent = "✔ Uploaded: " + (data.track?.name || name);
      await msLoadLibrary();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error: " + e.message;
    }
  };

  window.msGenerateAI = async function msGenerateAI() {
    const prompt   = document.getElementById("ms-ai-prompt")?.value.trim() || "";
    const dur      = parseInt(document.getElementById("ms-ai-dur")?.value || "30");
    const name     = document.getElementById("ms-ai-name")?.value.trim() || "AI Score";
    const statusEl = document.getElementById("ms-ai-status");
    const btn      = document.getElementById("ms-ai-btn");
    const preview  = document.getElementById("ms-ai-preview");
    if (!prompt) { if (statusEl) statusEl.textContent = "Describe the mood first."; return; }
    if (btn) { btn.disabled = true; btn.classList.add("lora-scanning"); }
    if (statusEl) statusEl.textContent = "Generating AI score…";
    try {
      const res  = await levFetch(`${MS_BASE}/music/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration: dur, name }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || "Generation failed");
      if (preview) { preview.src = MS_BASE + data.url; preview.style.display = "block"; preview.play().catch(() => {}); }
      if (statusEl) statusEl.textContent = "✔ Score generated: " + (data.name || name);
      await msLoadLibrary();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error: " + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
    }
  };

  window.msMixMusic = async function msMixMusic() {
    const trackUrl = document.getElementById("ms-mix-track")?.value || "";
    const videoUrl = document.getElementById("ms-mix-video")?.value || "";
    const vol      = parseInt(document.getElementById("ms-mix-vol")?.value || "25") / 100;
    const fade     = parseInt(document.getElementById("ms-mix-fade")?.value || "4");
    const statusEl = document.getElementById("ms-mix-status");
    const resultEl = document.getElementById("ms-mix-result");
    if (!trackUrl || !videoUrl) { if (statusEl) statusEl.textContent = "Select a track and a video."; return; }
    if (statusEl) statusEl.textContent = "Mixing…";
    try {
      const res  = await levFetch(`${MS_BASE}/music/mix`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ music_url: trackUrl, video_url: videoUrl, volume: vol, fade_out_sec: fade }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || "Mix failed");
      if (resultEl) { resultEl.src = MS_BASE + data.output_url; resultEl.style.display = "block"; resultEl.play().catch(() => {}); }
      if (statusEl) statusEl.textContent = "✔ Mixed! Playing below.";
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error: " + e.message;
    }
  };

  window.msDeleteTrack = async function msDeleteTrack(id) {
    try {
      await levFetch(`${MS_BASE}/music/${id}`, { method: "DELETE" });
      await msLoadLibrary();
    } catch (_) {}
  };

  window.msCopyUrl = function msCopyUrl(url) {
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { msLoadLibrary(); msLoadVideos(); }, 500);
  });
})();

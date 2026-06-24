const SB_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let _sbAllShots    = [];
let _sbFilter      = "all";
let _sbProject     = "";
let _sbView        = "script";  // "script" | "director"
let _sbChars       = [];        // [{id, name}, ...]
let _sbLocs        = [];        // [{name}, ...]
let _sbSelectMode  = false;
let _sbSelected    = new Set(); // selected shot IDs

// ── Meta (characters + locations for dropdowns) ────────────────

async function sbLoadMeta() {
  try {
    const [cRes, lRes] = await Promise.all([
      levFetch(`${SB_BASE}/characters`),
      levFetch(`${SB_BASE}/locations`),
    ]);
    const cData = await cRes.json();
    const lData = await lRes.json();
    _sbChars = (cData.characters || []).filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name));
    _sbLocs  = (lData.locations  || []).map(l => l.name).filter(Boolean).sort();
  } catch (_) {
    // non-fatal — dropdowns will still show typed value
  }
}

function _charOptions(current) {
  const names = _sbChars.map(c => c.name);
  const opts  = ["", ...(names.includes(current) || !current ? names : [current, ...names])];
  return opts.map(n => `<option value="${n}"${n === current ? " selected" : ""}>${n || "— none —"}</option>`).join("");
}

function _sbCharId(name) {
  if (!name) return "";
  const lc = name.trim().toLowerCase();
  return _sbChars.find(c => c.name.toLowerCase() === lc)?.id || "";
}

function _locOptions(current) {
  const opts = ["", ...(_sbLocs.includes(current) || !current ? _sbLocs : [current, ..._sbLocs])];
  return opts.map(n => `<option value="${n}"${n === current ? " selected" : ""}>${n || "— none —"}</option>`).join("");
}

// ── Helpers ────────────────────────────────────────────────────

function sbImgSrc(shot) {
  const raw = shot.renderOutputUrl || shot.imageUrl || "";
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  return `${SB_BASE}${raw.startsWith("/") ? raw : "/" + raw}`;
}

function sbSolClass(sol) {
  if (!sol || sol.skipped || sol.error) return "nodata";
  return sol.pass ? "pass" : "fail";
}

function sbSolText(sol) {
  if (!sol || sol.skipped || sol.error) return "— No Data";
  const pct = Math.round((sol.total || 0) * 100);
  return sol.pass ? `✔ SOL ${pct}%` : `✗ SOL ${pct}%`;
}

function sbIsPass(sol)   { return sol && !sol.skipped && !sol.error && sol.pass; }
function sbIsFail(sol)   { return sol && !sol.skipped && !sol.error && !sol.pass; }
function sbIsNoData(sol) { return !sol || sol.skipped || sol.error; }

// ── Data ───────────────────────────────────────────────────────

async function sbLoad() {
  const list = document.getElementById("sb-script");
  const grid = document.getElementById("sb-grid");
  if (list) list.innerHTML = '<div class="sb-empty">Loading…</div>';
  if (grid) grid.innerHTML = '<div class="sb-empty">Loading…</div>';

  try {
    const project = _sbProject;
    const url     = project
      ? `${SB_BASE}/scenes?project=${encodeURIComponent(project)}`
      : `${SB_BASE}/scenes`;
    const res  = await levFetch(url);
    const data = await res.json();
    _sbAllShots = (data.scenes || []).sort((a, b) => {
      const na = a.shot_number || "";
      const nb = b.shot_number || "";
      return na.localeCompare(nb, undefined, { numeric: true });
    });
    await sbLoadMeta();
    sbPopulateProjects();
    // Render whichever view is active
    if (_sbView === "script") sbRenderScript();
    else sbRenderFiltered();
  } catch (err) {
    console.error("[SB] load failed:", err);
    const msg = `<div class="sb-empty">Failed to load shots.<br>${err.message}</div>`;
    if (list) list.innerHTML = msg;
    if (grid) grid.innerHTML = msg;
  }
}

function sbPopulateProjects() {
  const sel = document.getElementById("sb-project-sel");
  if (!sel) return;
  const projects = [...new Set(
    _sbAllShots.map(s => s.project || "").filter(Boolean)
  )].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>' +
    projects.map(p => `<option value="${p}"${p === current ? " selected" : ""}>${p}</option>`).join("");
  // Restore active project from localStorage
  const active = localStorage.getItem("levram_active_project");
  if (active && projects.includes(active) && !current) sel.value = active;
}

function sbGetVisible() {
  const proj = _sbProject;
  let shots = proj
    ? _sbAllShots.filter(s => (s.project || "") === proj)
    : _sbAllShots;

  if (_sbFilter === "pass")   shots = shots.filter(s => sbIsPass(s.obedience_score));
  if (_sbFilter === "fail")   shots = shots.filter(s => sbIsFail(s.obedience_score));
  if (_sbFilter === "nodata") shots = shots.filter(s => sbIsNoData(s.obedience_score));
  return shots;
}

function sbGetProjectShots() {
  const proj = _sbProject;
  return proj ? _sbAllShots.filter(s => (s.project || "") === proj) : _sbAllShots;
}

// ── Render ─────────────────────────────────────────────────────

function sbRenderFiltered() {
  const all  = sbGetProjectShots();
  const pass = all.filter(s => sbIsPass(s.obedience_score)).length;
  const fail = all.filter(s => sbIsFail(s.obedience_score)).length;
  const nd   = all.length - pass - fail;

  const el = id => document.getElementById(id);
  if (el("sb-stat-total")) el("sb-stat-total").textContent = all.length;
  if (el("sb-stat-pass"))  el("sb-stat-pass").textContent  = pass;
  if (el("sb-stat-fail"))  el("sb-stat-fail").textContent  = fail;
  if (el("sb-stat-nd"))    el("sb-stat-nd").textContent    = nd;

  const shots = sbGetVisible();
  const grid  = el("sb-grid");
  if (!grid) return;

  if (!shots.length) {
    grid.innerHTML = `<div class="sb-empty">No shots match the current filter.<br>Run the orchestrator to generate keyframes.</div>`;
    return;
  }

  grid.innerHTML = shots.map(shot => sbCardHTML(shot)).join("");
}

function sbCardHTML(shot) {
  const sol      = shot.obedience_score;
  const imgSrc   = sbImgSrc(shot);
  const shotNum  = shot.shot_number || "—";
  const desc     = shot.shotDesc || shot.shot_description || "";
  const char     = shot.character || "";
  const solClass = sbSolClass(sol);
  const solText  = sbSolText(sol);
  const cardEdge = solClass === "pass" ? "sol-pass" : solClass === "fail" ? "sol-fail" : "";
  const id       = shot.id;
  const safeDesc = desc.replace(/`/g, "\\`").replace(/\$/g, "\\$");

  // SOL detail row
  let solDetail = "";
  if (sol && !sol.skipped && !sol.error) {
    const pct = v => Math.round((v || 0) * 100);
    solDetail = `
      <div class="sb-sol-detail">
        Chars <strong style="color:${(sol.characters||0)>=0.7?'var(--pass)':'var(--fail)'};">${pct(sol.characters)}%</strong>
        · Loc <strong>${pct(sol.location)}%</strong>
        · Action <strong style="color:${(sol.action||0)>=0.5?'var(--pass)':'var(--fail)'};">${pct(sol.action)}%</strong>
        · Outcome <strong>${pct(sol.outcome)}%</strong>
        ${sol.notes ? `<span class="sb-sol-note">${sol.notes.slice(0, 90)}${sol.notes.length > 90 ? "…" : ""}</span>` : ""}
      </div>`;
  }

  const regenBtnClass = sbIsFail(sol) ? "regen-btn" : "";
  const isSelectedD   = _sbSelected.has(id);

  return `
    <div id="sb-card-${id}" class="sb-card ${cardEdge}${isSelectedD ? " sb-selected" : ""}" data-id="${id}"
         onclick="_sbSelectMode && sbToggleCard('${id}')">
      ${_sbSelectMode ? `<div class="sb-select-check">${isSelectedD ? "☑" : "☐"}</div>` : ""}
      <div class="sb-card-num-bar">
        <span class="sb-card-num">${shotNum}</span>
        <span class="sb-sol-badge ${solClass}">${solText}</span>
      </div>
      <div class="sb-thumb-wrap">
        ${imgSrc
          ? `<img class="sb-thumb" src="${imgSrc}" loading="lazy" onclick="sbOpenLightbox('${imgSrc}','${shotNum}','${desc.replace(/'/g,"\\'")}')"/>`
          : `<div class="sb-thumb-placeholder">No Keyframe</div>`
        }
        <div class="sb-regen-overlay" id="sb-ov-${id}">
          <div class="sb-regen-spinner"></div>
          <div class="sb-regen-step" id="sb-step-${id}">Starting…</div>
        </div>
      </div>
      <div class="sb-card-body">
        <div class="sb-desc" title="${desc}">${desc || "(no description)"}</div>
        ${char ? `<div class="sb-char-row"><span class="sb-char-tag">${char}</span></div>` : ""}
        ${solDetail}
        <div class="sb-card-actions">
          ${imgSrc ? `<button class="sb-btn view-btn" onclick="sbOpenLightbox('${imgSrc}','${shotNum}','${desc.replace(/'/g,"\\'")}')">↗ View</button>` : ""}
          <button class="sb-btn ${regenBtnClass}" id="sb-regen-btn-${id}" onclick="sbToggleRegenPanel('${id}')">↻ Regen</button>
          <span class="sb-help-icon" tabindex="0">?
            <span class="sb-tooltip">
              <strong>↻ Regen</strong> — open this panel to edit the scene description, pick a style, then hit Generate.<br><br>
              <strong>✨ Enhance</strong> — AI rewrites your description into a richer image prompt.<br><br>
              <strong>Style buttons</strong> — set the visual mood: Cinematic, Action, Dramatic, Noir, Horror, Intimate, Epic.<br><br>
              <strong>↻ Generate</strong> — sends to WaveSpeed with your face lock + location lock applied.<br><br>
              <strong>Cancel</strong> — close without generating.
            </span>
          </span>
        </div>
      </div>
      <!-- Hover footer: Add After + Delete -->
      <div class="sb-card-footer">
        <button class="sb-footer-add" onclick="sbAddShot('${id}')">+ Add After</button>
        <button class="sb-footer-del" onclick="sbDeleteShot('${id}')">✕ Delete</button>
      </div>
      <!-- Regen edit panel (hidden until ↻ Regen is clicked) -->
      <div class="sb-regen-panel" id="sb-rp-${id}" style="display:none;">
        <div class="sb-rp-label">Scene Description</div>
        <textarea class="sb-rp-textarea" id="sb-rp-ta-${id}" rows="4">${desc}</textarea>
        <div class="sb-rp-styles">
          <button class="sb-rp-style active" data-style="cinematic" onclick="sbSetStyle('${id}',this)">Cinematic</button>
          <button class="sb-rp-style" data-style="action"    onclick="sbSetStyle('${id}',this)">Action</button>
          <button class="sb-rp-style" data-style="dramatic"  onclick="sbSetStyle('${id}',this)">Dramatic</button>
          <button class="sb-rp-style" data-style="noir"      onclick="sbSetStyle('${id}',this)">Noir</button>
          <button class="sb-rp-style" data-style="horror"    onclick="sbSetStyle('${id}',this)">Horror</button>
          <button class="sb-rp-style" data-style="intimate"  onclick="sbSetStyle('${id}',this)">Intimate</button>
          <button class="sb-rp-style" data-style="epic"      onclick="sbSetStyle('${id}',this)">Epic</button>
        </div>
        <div class="sb-rp-actions">
          <button class="sb-rp-enhance" id="sb-rp-enh-${id}" onclick="sbEnhanceDesc('${id}')">✨ Enhance</button>
          <div style="flex:1"></div>
          <button class="sb-rp-cancel"  onclick="sbToggleRegenPanel('${id}')">Cancel</button>
          <button class="sb-rp-confirm" id="sb-rp-go-${id}"  onclick="sbRegenShot('${id}')">↻ Generate</button>
        </div>
      </div>
    </div>`;
}

// ── Regen Panel ────────────────────────────────────────────────

function sbToggleRegenPanel(shotId) {
  const panel = document.getElementById(`sb-rp-${shotId}`);
  if (!panel) return;
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    // Auto-resize textarea on open
    const ta = document.getElementById(`sb-rp-ta-${shotId}`);
    if (ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  }
}

function sbSetStyle(shotId, btn) {
  const panel = document.getElementById(`sb-rp-${shotId}`);
  if (!panel) return;
  panel.querySelectorAll(".sb-rp-style").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

async function sbEnhanceDesc(shotId) {
  const ta  = document.getElementById(`sb-rp-ta-${shotId}`);
  const btn = document.getElementById(`sb-rp-enh-${shotId}`);
  const panel = document.getElementById(`sb-rp-${shotId}`);
  if (!ta || !btn) return;

  const style = panel?.querySelector(".sb-rp-style.active")?.dataset?.style || "cinematic";
  const desc  = ta.value.trim();
  if (!desc) return;

  btn.textContent = "Enhancing…";
  btn.disabled = true;

  try {
    const res  = await levFetch(`${SB_BASE}/scene/enhance-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: desc, style }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Enhance failed");
    ta.value = data.enhanced;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    btn.textContent = "✨ Enhanced";
    setTimeout(() => { btn.textContent = "✨ Enhance"; btn.disabled = false; }, 1800);
  } catch (err) {
    btn.textContent = "✨ Enhance";
    btn.disabled = false;
    console.error("[SB] enhance failed:", err);
  }
}

// ── Regen ──────────────────────────────────────────────────────

async function sbRegenShot(shotId) {
  const shot = _sbAllShots.find(s => s.id === shotId);
  if (!shot) return;

  // Read description from panel textarea if open, else use stored desc
  const ta        = document.getElementById(`sb-rp-ta-${shotId}`);
  const newDesc   = ta ? ta.value.trim() : "";
  const finalDesc = newDesc || shot.shotDesc || shot.shot_description || "";

  // Close panel and show overlay
  const panel    = document.getElementById(`sb-rp-${shotId}`);
  if (panel) panel.style.display = "none";
  const overlay  = document.getElementById(`sb-ov-${shotId}`);
  const stepEl   = document.getElementById(`sb-step-${shotId}`);
  const regenBtn = document.getElementById(`sb-regen-btn-${shotId}`);
  if (overlay)  overlay.classList.add("active");
  if (stepEl)   stepEl.textContent = "Starting…";
  if (regenBtn) regenBtn.disabled = true;

  try {
    const res = await levFetch(`${SB_BASE}/orchestrate/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes: [{
          shot_id:        shot.id,
          description:    finalDesc,
          image_prompt:   finalDesc,
          motion_prompt:  shot.motion_prompt || "cinematic motion, smooth camera",
          dialogue:       shot.dialogue || "",
          scene_contract: shot.scene_contract || null,
          character:      shot.character || "",
          character2:     shot.character2 || shot.char2 || "",
          location:       shot.location || shot.environment || "",
        }],
        character_name:  shot.character || "",
        character_id:    shot.character_id  || _sbCharId(shot.character),
        character2_id:   shot.character2_id || _sbCharId(shot.character2 || shot.char2),
        keyframes_only:  true,
        project:         shot.project || "",
        clear_project:   false,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to start regen");

    await sbPollRegen(shotId, data.job_id, overlay, stepEl);
  } catch (err) {
    console.error("[SB] regen error:", err);
    if (stepEl) stepEl.textContent = "Error: " + err.message.slice(0, 60);
    setTimeout(() => {
      if (overlay) overlay.classList.remove("active");
      if (regenBtn) regenBtn.disabled = false;
    }, 4000);
  }
}

async function sbPollRegen(shotId, jobId, overlay, stepEl) {
  let attempts = 0;
  const max = 150; // 5 min at 2s interval

  while (attempts < max) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    try {
      const res  = await levFetch(`${SB_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();

      if (stepEl) stepEl.textContent = (data.step || "Working…").slice(0, 80);

      if (data.status === "keyframes_ready" || data.status === "complete") {
        const newShot = data.shots?.[0];
        if (newShot) {
          const idx = _sbAllShots.findIndex(s => s.id === shotId);
          const merged = { ...(_sbAllShots[idx] || {}), ...newShot, id: shotId };
          if (idx >= 0) _sbAllShots[idx] = merged;
          // Replace card HTML in place
          const card = document.getElementById(`sb-card-${shotId}`);
          if (card) card.outerHTML = sbCardHTML(merged);
        }
        if (overlay) overlay.classList.remove("active");
        sbRenderFiltered();
        return;
      }

      if (data.status === "failed") {
        if (stepEl) stepEl.textContent = "Failed: " + (data.error || "unknown").slice(0, 60);
        setTimeout(() => { if (overlay) overlay.classList.remove("active"); }, 4000);
        return;
      }
    } catch (_) { /* keep polling */ }
  }

  if (overlay) overlay.classList.remove("active");
}

// ── Lightbox ───────────────────────────────────────────────────

function sbOpenLightbox(imgUrl, shotNum, desc) {
  const lb   = document.getElementById("sb-lightbox");
  const img  = document.getElementById("sb-lightbox-img");
  const meta = document.getElementById("sb-lightbox-meta");
  if (!lb || !img) return;
  img.src  = imgUrl;
  if (meta) meta.textContent = [shotNum, desc].filter(Boolean).join(" — ").slice(0, 100);
  lb.classList.add("open");
}

function sbCloseLightbox() {
  document.getElementById("sb-lightbox")?.classList.remove("open");
}

// ── View Toggle ────────────────────────────────────────────────

function sbSetView(view) {
  _sbView = view;
  document.getElementById("sb-view-script")?.classList.toggle("active",   view === "script");
  document.getElementById("sb-view-director")?.classList.toggle("active", view === "director");

  const scriptBar  = document.getElementById("sb-script-bar");
  const dirBar     = document.getElementById("sb-director-bar");
  const scriptList = document.getElementById("sb-script");
  const grid       = document.getElementById("sb-grid");

  if (view === "script") {
    if (scriptBar)  scriptBar.style.display  = "";
    if (dirBar)     dirBar.style.display     = "none";
    if (scriptList) scriptList.style.display = "";
    if (grid)       grid.style.display       = "none";
    sbRenderScript();
  } else {
    if (scriptBar)  scriptBar.style.display  = "none";
    if (dirBar)     dirBar.style.display     = "";
    if (scriptList) scriptList.style.display = "none";
    if (grid)       grid.style.display       = "";
    sbRenderFiltered();
  }
}

// ── Script View ────────────────────────────────────────────────

function sbRenderScript() {
  const shots  = sbGetProjectShots();
  const list   = document.getElementById("sb-script");
  const total2 = document.getElementById("sb-stat-total2");
  const keyed  = document.getElementById("sb-stat-keyed");

  const keyedCount = shots.filter(s => !!(s.renderOutputUrl || s.imageUrl)).length;
  if (total2) total2.textContent = shots.length;
  if (keyed)  keyed.textContent  = `${keyedCount} / ${shots.length}`;

  if (!list) return;

  if (!shots.length) {
    list.innerHTML = `<div class="sb-empty">No shots in this project.<br>Use the Idea Vault to write scenes, then come back here to review before generating.</div>`;
    return;
  }

  list.innerHTML = shots.map(shot => sbScriptCardHTML(shot)).join("");

  // Auto-resize all textareas
  list.querySelectorAll("textarea.sb-field-input").forEach(ta => {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    ta.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = this.scrollHeight + "px";
    });
  });
}

function sbScriptCardHTML(shot) {
  const id      = shot.id;
  const num     = shot.shot_number || "—";
  const desc    = shot.shotDesc || shot.shot_description || shot.shot_prompt || "";
  const diag    = shot.dialogue || "";
  const char1   = shot.character || "";
  const char2   = shot.character2 || shot.char2 || "";
  const loc     = shot.location || shot.environment || "";
  const motion  = shot.motion_prompt || "";
  const hasKey  = !!(shot.renderOutputUrl || shot.imageUrl);

  const charTags = [char1, char2].filter(Boolean)
    .map(c => `<span class="sb-shot-char-tag">${c}</span>`).join("");

  const esc = s => (s || "").replace(/`/g, "\\`").replace(/\$/g, "\\$");

  const isSelected = _sbSelected.has(id);

  return `
<div class="sb-shot-card ${hasKey ? "has-key" : "no-key"}${isSelected ? " sb-selected" : ""}" id="ssc-${id}"
     onclick="_sbSelectMode && sbToggleCard('${id}')">
  ${_sbSelectMode ? `<div class="sb-select-check">${isSelected ? "☑" : "☐"}</div>` : ""}
  <div class="sb-shot-header">
    <span class="sb-shot-num">SHOT ${num}</span>
    <div class="sb-shot-chars">${charTags || '<span style="color:var(--text-dim);font-size:10px;letter-spacing:1px;">No Characters</span>'}</div>
    <span class="sb-shot-key-dot ${hasKey ? "has" : "none"}" title="${hasKey ? "Keyframe generated" : "No keyframe yet"}"></span>
  </div>
  <div class="sb-shot-body">
    <div class="sb-field-row">
      <div class="sb-field-label">Description / Visual</div>
      <textarea class="sb-field-input" rows="3"
        data-shot="${id}" data-field="shotDesc"
        onblur="sbSaveField('${id}','shotDesc',this.value)">${desc}</textarea>
    </div>
    <div class="sb-field-row">
      <div class="sb-field-label" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Dialogue</span>
        <button class="sb-write-btn" id="sb-write-${id}" onclick="sbWriteScene('${id}')" title="AI fills dialogue + camera motion from the scene description">✨ Write</button>
      </div>
      <textarea class="sb-field-input dialogue" rows="2"
        data-shot="${id}" data-field="dialogue"
        placeholder="No dialogue — silent scene"
        onblur="sbSaveField('${id}','dialogue',this.value)">${diag}</textarea>
    </div>
    <div class="sb-field-row">
      <div class="sb-field-label">Motion / Action Note</div>
      <textarea class="sb-field-input" rows="2"
        data-shot="${id}" data-field="motion_prompt"
        placeholder="How does this shot move?"
        onblur="sbSaveField('${id}','motion_prompt',this.value)">${motion}</textarea>
    </div>
    <div class="sb-field-row-inline">
      <div class="sb-field-row">
        <div class="sb-field-label">Character 1</div>
        <select class="sb-field-input sb-field-select"
          data-shot="${id}" data-field="character"
          onchange="sbSaveField('${id}','character',this.value)">${_charOptions(char1)}</select>
      </div>
      <div class="sb-field-row">
        <div class="sb-field-label">Character 2</div>
        <select class="sb-field-input sb-field-select"
          data-shot="${id}" data-field="character2"
          onchange="sbSaveField('${id}','character2',this.value)">${_charOptions(char2)}</select>
      </div>
    </div>
    <div class="sb-field-row">
      <div class="sb-field-label">Location</div>
      <select class="sb-field-input sb-field-select"
        data-shot="${id}" data-field="location"
        onchange="sbSaveField('${id}','location',this.value)">${_locOptions(loc)}</select>
    </div>
    <div class="sb-save-indicator" id="si-${id}"></div>
  </div>
  <!-- Hover footer: Add After + Delete -->
  <div class="ssc-card-footer">
    <button class="sb-footer-add" onclick="sbAddShot('${id}')">+ Add After</button>
    <button class="sb-footer-del" onclick="sbDeleteShot('${id}')">✕ Delete</button>
  </div>
</div>`;
}

// Save a single field via PATCH
const _sbSaveDebounce = {};
async function sbSaveField(shotId, field, value) {
  // Update local cache
  const shot = _sbAllShots.find(s => s.id === shotId);
  if (shot) shot[field] = value;

  const ind = document.getElementById(`si-${shotId}`);
  if (ind) { ind.textContent = "Saving…"; ind.className = "sb-save-indicator saving"; }

  clearTimeout(_sbSaveDebounce[shotId + field]);
  _sbSaveDebounce[shotId + field] = setTimeout(async () => {
    try {
      const res = await levFetch(`${SB_BASE}/scene/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      if (ind) { ind.textContent = "Saved"; ind.className = "sb-save-indicator saved"; }
      setTimeout(() => { if (ind) ind.className = "sb-save-indicator"; }, 2000);
    } catch (err) {
      console.error("[SB] patch failed:", err);
      if (ind) { ind.textContent = "Save failed"; ind.className = "sb-save-indicator err"; }
    }
  }, 600);
}

// Generate keyframes for all shots missing an image
async function sbGenMissing() {
  const shots = sbGetProjectShots().filter(s => !(s.renderOutputUrl || s.imageUrl));
  if (!shots.length) {
    const st = document.getElementById("sb-gen-status");
    if (st) st.textContent = "All shots already have keyframes.";
    return;
  }

  const btn = document.getElementById("sb-gen-missing");
  const st  = document.getElementById("sb-gen-status");
  if (btn) btn.disabled = true;
  if (st)  st.textContent = `Starting ${shots.length} shots…`;

  try {
    const res = await levFetch(`${SB_BASE}/orchestrate/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes:         shots.map(s => ({
          shot_id:       s.id,
          description:   s.shotDesc || s.shot_description || "",
          image_prompt:  s.shot_prompt || s.shotDesc || s.shot_description || "",
          motion_prompt: s.motion_prompt || "cinematic motion, smooth camera",
          dialogue:      s.dialogue || "",
          scene_contract: s.scene_contract || null,
          character:     s.character || "",
          character2:    s.character2 || s.char2 || "",
          location:      s.location || s.environment || "",
        })),
        character_name: shots[0]?.character || "",
        character_id:   shots[0]?.character_id || _sbCharId(shots[0]?.character),
        character2_id:  shots[0]?.character2_id || _sbCharId(shots[0]?.character2 || shots[0]?.char2),
        keyframes_only: true,
        project:        _sbProject || shots[0]?.project || "",
        clear_project:  false,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to start");

    if (st) st.textContent = `Running… job ${data.job_id.slice(0, 8)}`;
    sbPollGenMissing(data.job_id, shots.length);
  } catch (err) {
    console.error("[SB] gen missing failed:", err);
    if (st) st.textContent = "Error: " + err.message.slice(0, 60);
    if (btn) btn.disabled = false;
  }
}

async function sbPollGenMissing(jobId, total) {
  const btn   = document.getElementById("sb-gen-missing");
  const st    = document.getElementById("sb-gen-status");
  const start = Date.now();
  let attempts = 0;
  const MAX_MINUTES = 20;
  const MAX_ATTEMPTS = (MAX_MINUTES * 60) / 2; // 2s interval

  while (attempts < MAX_ATTEMPTS) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    try {
      const res  = await levFetch(`${SB_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();

      const elapsed = Math.floor((Date.now() - start) / 1000);
      const mins    = Math.floor(elapsed / 60);
      const secs    = elapsed % 60;
      const timer   = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const prog    = data.progress != null ? `${data.progress}/${data.total || total}` : "";
      const step    = (data.step || "Working…").slice(0, 80);
      if (st) st.textContent = `${step}  ${prog ? `[${prog}]` : ""}  ${timer}`;

      if (data.status === "keyframes_ready" || data.status === "complete") {
        (data.shots || []).forEach(newShot => {
          const idx = _sbAllShots.findIndex(s => s.id === newShot.id);
          if (idx >= 0) _sbAllShots[idx] = { ..._sbAllShots[idx], ...newShot };
          else _sbAllShots.push(newShot);
        });
        sbRenderScript();
        if (st) st.textContent = `✓ Done — ${data.progress || total} keyframes generated`;
        if (btn) btn.disabled = false;
        return;
      }
      if (data.status === "failed") {
        if (st) st.textContent = "Failed: " + (data.error || "unknown").slice(0, 80);
        if (btn) btn.disabled = false;
        return;
      }
    } catch (_) { /* keep polling */ }
  }

  if (st) st.textContent = `Still generating — job ${jobId.slice(0, 8)} is running in the background. Refresh when ready.`;
  if (btn) btn.disabled = false;
}

// ── Init ───────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  // Project selector
  document.getElementById("sb-project-sel")?.addEventListener("change", function () {
    _sbProject = this.value;
    sbLoad();
  });

  // Filter buttons
  document.querySelectorAll(".sb-filter-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".sb-filter-btn").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      _sbFilter = this.dataset.filter;
      sbRenderFiltered();
    });
  });

  // Keyboard close lightbox
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") sbCloseLightbox();
  });

  // URL param ?project= takes priority over localStorage
  const urlProject = new URLSearchParams(window.location.search).get("project");
  if (urlProject) {
    _sbProject = urlProject;
    localStorage.setItem("levram_active_project", urlProject);
  } else {
    const saved = localStorage.getItem("levram_active_project");
    if (saved) _sbProject = saved;
  }

  sbLoad();
});

window.sbOpenLightbox      = sbOpenLightbox;
window.sbCloseLightbox     = sbCloseLightbox;
window.sbRegenShot         = sbRegenShot;
window.sbSetView           = sbSetView;
window.sbSaveField         = sbSaveField;
window.sbGenMissing        = sbGenMissing;
window.sbToggleRegenPanel  = sbToggleRegenPanel;
window.sbSetStyle          = sbSetStyle;
window.sbEnhanceDesc       = sbEnhanceDesc;

// ── Add Shot (after a specific card, or at end) ───────────────

async function sbAddShot(afterId = null) {
  try {
    const res = await levFetch(`${SB_BASE}/save-scene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: _sbProject || "", shot_description: "", scene_number: "" }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Failed to create shot");

    // Find insertion index in the global array
    let globalIdx = _sbAllShots.length;
    if (afterId) {
      const i = _sbAllShots.findIndex(s => s.id === afterId);
      if (i >= 0) globalIdx = i + 1;
    }

    // Shot number = position after afterId within project shots
    const projShots = sbGetProjectShots();
    let projPos = projShots.length + 1;
    if (afterId) {
      const pi = projShots.findIndex(s => s.id === afterId);
      if (pi >= 0) projPos = pi + 2;
    }
    const shotNum = `SC-${String(projPos).padStart(3, "0")}`;

    const newShot = {
      ...data.scene,
      shotDesc:    data.scene.shot_description || "",
      shot_number: shotNum,
      project:     _sbProject || data.scene.project || "",
    };
    _sbAllShots.splice(globalIdx, 0, newShot);

    // Persist shot_number to DB
    levFetch(`${SB_BASE}/scene/${newShot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shot_number: shotNum, project: newShot.project }),
    });

    if (_sbView === "script") sbRenderScript(); else sbRenderFiltered();

    // Scroll new card into view
    setTimeout(() => {
      const el = document.getElementById(`ssc-${newShot.id}`) || document.getElementById(`sb-card-${newShot.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  } catch (err) {
    console.error("[SB] add shot failed:", err);
    const st = document.getElementById("sb-gen-status");
    if (st) st.textContent = "Add shot failed: " + err.message.slice(0, 60);
  }
}

// ── Delete Shot ────────────────────────────────────────────────

async function sbDeleteShot(id) {
  if (!confirm("Delete this shot? This cannot be undone.")) return;
  try {
    const res = await levFetch(`${SB_BASE}/scene/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Server returned " + res.status);
    _sbAllShots = _sbAllShots.filter(s => s.id !== id);
    if (_sbView === "script") sbRenderScript(); else sbRenderFiltered();
  } catch (err) {
    console.error("[SB] delete failed:", err);
    alert("Delete failed: " + err.message);
  }
}

window.sbAddShot    = sbAddShot;
window.sbDeleteShot = sbDeleteShot;

async function sbWriteScene(shotId) {
  const shot = _sbAllShots.find(s => s.id === shotId);
  if (!shot) return;

  const btn = document.getElementById(`sb-write-${shotId}`);
  if (btn) { btn.textContent = "Writing…"; btn.disabled = true; }

  try {
    const res  = await levFetch(`${SB_BASE}/scene/write-scene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: shot.shotDesc || shot.shot_description || "",
        character:   shot.character || "",
        character2:  shot.character2 || shot.char2 || "",
        tone:        "cinematic dark superhero",
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Write failed");

    // Fill dialogue textarea
    const diagEl = document.querySelector(`[data-shot="${shotId}"][data-field="dialogue"]`);
    if (diagEl && data.dialogue) {
      diagEl.value = data.dialogue;
      sbSaveField(shotId, "dialogue", data.dialogue);
    }
    // Fill motion textarea
    const motEl = document.querySelector(`[data-shot="${shotId}"][data-field="motion_prompt"]`);
    if (motEl && data.motion) {
      motEl.value = data.motion;
      sbSaveField(shotId, "motion_prompt", data.motion);
    }
    if (btn) { btn.textContent = "✓ Done"; setTimeout(() => { btn.textContent = "✨ Write"; btn.disabled = false; }, 1800); }
  } catch (err) {
    console.error("[SB] write-scene failed:", err);
    if (btn) { btn.textContent = "Error"; setTimeout(() => { btn.textContent = "✨ Write"; btn.disabled = false; }, 2500); }
  }
}
window.sbWriteScene = sbWriteScene;

// ── Multi-select ───────────────────────────────────────────────

function sbToggleSelectMode() {
  _sbSelectMode = !_sbSelectMode;
  _sbSelected.clear();

  const bar    = document.getElementById("sb-select-bar");
  const togS   = document.getElementById("sb-select-toggle-script");
  const togD   = document.getElementById("sb-select-toggle-director");

  if (_sbSelectMode) {
    bar?.style.setProperty("display", "flex");
    togS && (togS.textContent = "✕ Cancel Select") && togS.classList.add("active");
    togD && (togD.textContent = "✕ Cancel Select") && togD.classList.add("active");
    document.body.classList.add("sb-select-mode");
  } else {
    bar?.style.setProperty("display", "none");
    togS && (togS.textContent = "☐ Select") && togS.classList.remove("active");
    togD && (togD.textContent = "☐ Select") && togD.classList.remove("active");
    document.body.classList.remove("sb-select-mode");
  }

  if (_sbView === "script") sbRenderScript(); else sbRenderFiltered();
}

function sbToggleCard(id) {
  if (!_sbSelectMode) return false;
  if (_sbSelected.has(id)) _sbSelected.delete(id); else _sbSelected.add(id);
  _sbUpdateSelectBar();
  // Toggle selected class on the card
  const card = document.getElementById(`ssc-${id}`) || document.getElementById(`sb-card-${id}`);
  card?.classList.toggle("sb-selected", _sbSelected.has(id));
  return true;
}

function _sbUpdateSelectBar() {
  const n = _sbSelected.size;
  const countEl = document.getElementById("sb-select-count");
  const delBtn  = document.getElementById("sb-select-del");
  if (countEl) countEl.textContent = `${n} selected`;
  if (delBtn)  delBtn.textContent  = n ? `🗑 Delete ${n} Shot${n !== 1 ? "s" : ""}` : "🗑 Delete Selected";
  if (delBtn)  delBtn.disabled     = n === 0;
}

function sbSelectAll() {
  sbGetProjectShots().forEach(s => _sbSelected.add(s.id));
  _sbUpdateSelectBar();
  document.querySelectorAll(".sb-shot-card, .sb-card").forEach(el => el.classList.add("sb-selected"));
}

function sbSelectNone() {
  _sbSelected.clear();
  _sbUpdateSelectBar();
  document.querySelectorAll(".sb-shot-card, .sb-card").forEach(el => el.classList.remove("sb-selected"));
}

async function sbDeleteSelected() {
  const ids = [..._sbSelected];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} shot${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;

  const btn = document.getElementById("sb-select-del");
  if (btn) { btn.textContent = "Deleting…"; btn.disabled = true; }

  let failed = 0;
  for (const id of ids) {
    try {
      const res = await levFetch(`${SB_BASE}/scene/${id}`, { method: "DELETE" });
      if (!res.ok) failed++;
      else _sbAllShots = _sbAllShots.filter(s => s.id !== id);
    } catch (_) { failed++; }
  }

  _sbSelected.clear();
  sbToggleSelectMode(); // exit select mode, re-render
  if (failed) alert(`${failed} shot${failed !== 1 ? "s" : ""} failed to delete — check logs.`);
}

window.sbToggleSelectMode = sbToggleSelectMode;
window.sbToggleCard       = sbToggleCard;
window.sbSelectAll        = sbSelectAll;
window.sbSelectNone       = sbSelectNone;
window.sbDeleteSelected   = sbDeleteSelected;

// ── Import Script ──────────────────────────────────────────────

function sbOpenImport() {
  const modal = document.getElementById("sb-import-modal");
  if (!modal) return;
  // Pre-fill project and character fields from current context
  const projIn = document.getElementById("sb-import-project");
  const char1In = document.getElementById("sb-import-char1");
  if (projIn && !projIn.value && _sbProject) projIn.value = _sbProject;
  modal.classList.add("open");
  document.getElementById("sb-import-script")?.focus();
}

function sbCloseImport() {
  document.getElementById("sb-import-modal")?.classList.remove("open");
}

async function sbRunImport() {
  const script  = document.getElementById("sb-import-script")?.value.trim();
  const count   = parseInt(document.getElementById("sb-import-count")?.value || "28");
  const project = document.getElementById("sb-import-project")?.value.trim() || _sbProject || "Untitled";
  const char1   = document.getElementById("sb-import-char1")?.value.trim() || "";
  const char2   = document.getElementById("sb-import-char2")?.value.trim() || "";
  const btn     = document.getElementById("sb-import-run-btn");
  const statEl  = document.getElementById("sb-import-status");

  if (!script) { if (statEl) statEl.textContent = "Paste a script first."; return; }

  if (btn)    { btn.disabled = true; btn.textContent = "Breaking down…"; }
  if (statEl) statEl.textContent = "Hermes is reading your script…";

  try {
    const res  = await levFetch(`${SB_BASE}/scenes/import-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, num_shots: count, project, character: char1, character2: char2 }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Import failed");

    const n = data.shots?.length || 0;

    // Switch to this project
    _sbProject = project;
    localStorage.setItem("levram_active_project", project);
    const sel = document.getElementById("sb-project-sel");
    if (sel) sel.value = project;

    if (statEl) statEl.innerHTML =
      `<span style="color:#4caf50;">✓ ${n} shots imported</span>
       <button onclick="sbCloseImport();sbLoad();"
         style="margin-left:14px;background:#c9a84c;color:#000;border:none;border-radius:2px;
                padding:6px 18px;font-family:Rajdhani,sans-serif;font-size:14px;font-weight:700;
                letter-spacing:1px;cursor:pointer;">→ View Shots</button>`;
  } catch (err) {
    if (statEl) statEl.innerHTML = `<span style="color:var(--fail);">${err.message}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ Break Down Script"; }
  }
}

window.sbOpenImport  = sbOpenImport;
window.sbCloseImport = sbCloseImport;
window.sbRunImport   = sbRunImport;

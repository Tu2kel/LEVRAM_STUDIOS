const SB_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let _sbAllShots  = [];
let _sbFilter    = "all";
let _sbProject   = "";
let _sbView      = "script";  // "script" | "director"

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

  return `
    <div id="sb-card-${id}" class="sb-card ${cardEdge}" data-id="${id}">
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
          <button class="sb-btn ${regenBtnClass}" id="sb-regen-btn-${id}" onclick="sbRegenShot('${id}')">↻ Regen</button>
        </div>
      </div>
    </div>`;
}

// ── Regen ──────────────────────────────────────────────────────

async function sbRegenShot(shotId) {
  const shot = _sbAllShots.find(s => s.id === shotId);
  if (!shot) return;

  const overlay = document.getElementById(`sb-ov-${shotId}`);
  const stepEl  = document.getElementById(`sb-step-${shotId}`);
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
          description:    shot.shotDesc || shot.shot_description || "",
          image_prompt:   shot.shotPrompt || shot.shot_prompt || shot.shotDesc || "",
          motion_prompt:  shot.motion_prompt || "cinematic motion, smooth camera",
          dialogue:       shot.dialogue || "",
          required_action:  shot.obedience_score?.notes ? "" : "",
          scene_contract: shot.scene_contract || null,
        }],
        character_name:  shot.character || "",
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

  return `
<div class="sb-shot-card ${hasKey ? "has-key" : "no-key"}" id="ssc-${id}">
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
      <div class="sb-field-label">Dialogue</div>
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
        <input class="sb-field-input" type="text" value="${char1}"
          data-shot="${id}" data-field="character"
          onblur="sbSaveField('${id}','character',this.value)" />
      </div>
      <div class="sb-field-row">
        <div class="sb-field-label">Character 2</div>
        <input class="sb-field-input" type="text" value="${char2}"
          data-shot="${id}" data-field="character2"
          onblur="sbSaveField('${id}','character2',this.value)" />
      </div>
    </div>
    <div class="sb-field-row">
      <div class="sb-field-label">Location</div>
      <input class="sb-field-input" type="text" value="${loc}"
        data-shot="${id}" data-field="location"
        onblur="sbSaveField('${id}','location',this.value)" />
    </div>
    <div class="sb-save-indicator" id="si-${id}"></div>
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
        })),
        character_name: shots[0]?.character || "",
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
  const btn = document.getElementById("sb-gen-missing");
  const st  = document.getElementById("sb-gen-status");
  let attempts = 0;

  while (attempts < 180) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    try {
      const res  = await levFetch(`${SB_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();
      if (st) st.textContent = (data.step || "Working…").slice(0, 80);

      if (data.status === "keyframes_ready" || data.status === "complete") {
        // Merge new shot data into cache
        (data.shots || []).forEach(newShot => {
          const idx = _sbAllShots.findIndex(s => s.id === newShot.id);
          if (idx >= 0) _sbAllShots[idx] = { ..._sbAllShots[idx], ...newShot };
          else _sbAllShots.push(newShot);
        });
        sbRenderScript();
        if (st) st.textContent = `Done — ${total} keyframes generated`;
        if (btn) btn.disabled = false;
        return;
      }
      if (data.status === "failed") {
        if (st) st.textContent = "Failed: " + (data.error || "unknown").slice(0, 60);
        if (btn) btn.disabled = false;
        return;
      }
    } catch (_) { /* keep polling */ }
  }

  if (st) st.textContent = "Timed out — check orchestrator status";
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

  // Restore active project
  const saved = localStorage.getItem("levram_active_project");
  if (saved) _sbProject = saved;

  sbLoad();
});

window.sbOpenLightbox  = sbOpenLightbox;
window.sbCloseLightbox = sbCloseLightbox;
window.sbRegenShot     = sbRegenShot;
window.sbSetView       = sbSetView;
window.sbSaveField     = sbSaveField;
window.sbGenMissing    = sbGenMissing;

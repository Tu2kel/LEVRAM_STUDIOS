const SB_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let _sbAllShots  = [];
let _sbFilter    = "all";
let _sbProject   = "";

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
  const grid = document.getElementById("sb-grid");
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
    sbRenderFiltered();
  } catch (err) {
    console.error("[SB] load failed:", err);
    if (grid) grid.innerHTML = `<div class="sb-empty">Failed to load shots.<br>${err.message}</div>`;
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

// ─── Idea Vault ───────────────────────────────────────────────
const IV_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let ivCurrentIdeaId = null;

// ── Load character dropdown ────────────────────────────────────
async function ivLoadCharacters() {
  const sel = document.getElementById("iv-dev-character");
  if (!sel) return;
  try {
    const res  = await levFetch(`${IV_BASE}/characters`);
    const data = await res.json();
    (data.characters || []).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name; o.dataset.name = c.name;
      sel.appendChild(o);
    });
  } catch (_) {}
}

// ── List ───────────────────────────────────────────────────────
async function ivLoadIdeas() {
  const list = document.getElementById("iv-list");
  if (!list) return;
  try {
    const res  = await levFetch(`${IV_BASE}/ideas`);
    const data = await res.json();
    const ideas = data.ideas || [];
    if (!ideas.length) {
      list.innerHTML = `<p style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No ideas saved yet.</p>`;
      return;
    }
    list.innerHTML = ideas.map(idea => {
      const statusColor = {
        raw: "rgba(255,255,255,0.3)", developed: "rgba(201,168,76,0.8)",
        approved: "#4caf50", generating: "#2196f3", done: "#9c27b0",
      }[idea.status] || "rgba(255,255,255,0.3)";
      const mins    = idea.target_minutes || 8;
      const secPer  = idea.scene_seconds  || 5;
      const scenes  = Math.ceil((mins * 60 / secPer) * 1.1);
      return `
        <div class="iv-card" style="cursor:default;">
          <div class="iv-card-top">
            <span class="iv-card-title">${idea.title || "Untitled"}</span>
            <button class="tl-del-btn" title="Delete" onclick="ivDeleteIdea('${idea.id}')">✕</button>
          </div>
          <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;margin-bottom:4px;">
            ${idea.genre || "sci-fi action"} &nbsp;·&nbsp; ${mins} min &nbsp;·&nbsp; ~${scenes} scenes
          </div>
          ${idea.tags?.length ? `<div class="iv-tags">${idea.tags.map(t => `<span class="iv-tag">${t}</span>`).join("")}</div>` : ""}
          <div class="iv-card-body" style="max-height:60px;overflow:hidden;text-overflow:ellipsis;">${idea.rawIdea || ""}</div>
          <div style="display:flex;gap:6px;margin-top:8px;align-items:center;">
            <span style="font-size:9px;color:${statusColor};letter-spacing:1px;text-transform:uppercase;">${idea.status}</span>
            <button onclick="ivDevelopIdea('${idea.id}')"
              style="flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
              ${idea.story ? "View / Re-develop" : "⚡ Develop Story"}
            </button>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error("IV LOAD ERROR:", err);
    list.innerHTML = `<p style="color:var(--imperial-red);font-size:11px;">Could not load ideas.</p>`;
  }
}

// ── Save ───────────────────────────────────────────────────────
async function ivSaveIdea() {
  const title    = document.getElementById("iv-title")?.value.trim() || "";
  const text     = document.getElementById("iv-text")?.value.trim()  || "";
  const tags     = document.getElementById("iv-tags")?.value.trim()  || "";
  const genre    = document.getElementById("iv-genre")?.value.trim() || "sci-fi action";
  const minutes  = parseFloat(document.getElementById("iv-minutes")?.value || "8");
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");
  const statusEl = document.getElementById("iv-status");

  if (!title) { if (statusEl) statusEl.textContent = "Add a title first."; return; }
  if (!text)  { if (statusEl) statusEl.textContent = "Write the idea."; return; }

  try {
    const res = await levFetch(`${IV_BASE}/ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, rawIdea: text, source: "web", genre,
        target_minutes: minutes, scene_seconds: sceneSec,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Save failed");
    document.getElementById("iv-title").value = "";
    document.getElementById("iv-text").value  = "";
    document.getElementById("iv-tags").value  = "";
    if (statusEl) statusEl.textContent = `Saved: "${title}"`;
    await ivLoadIdeas();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Failed to save.";
  }
}

// ── Delete ─────────────────────────────────────────────────────
async function ivDeleteIdea(id) {
  try {
    const res = await levFetch(`${IV_BASE}/ideas/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    if (ivCurrentIdeaId === id) {
      const panel = document.getElementById("iv-story-panel");
      if (panel) panel.style.display = "none";
      ivCurrentIdeaId = null;
    }
    await ivLoadIdeas();
  } catch (err) {
    console.error("IV DELETE ERROR:", err);
  }
}

// ── Develop ────────────────────────────────────────────────────
window.ivDevelopIdea = async function ivDevelopIdea(id) {
  ivCurrentIdeaId = id;
  const panel    = document.getElementById("iv-story-panel");
  const titleEl  = document.getElementById("iv-story-title");
  const durEl    = document.getElementById("iv-story-duration");
  const metaEl   = document.getElementById("iv-story-meta");
  const sceneEl  = document.getElementById("iv-scene-list");
  const reelEl   = document.getElementById("iv-reel-row");
  const approveEl = document.getElementById("iv-approve-status");
  const approveBtn = document.getElementById("iv-approve-btn");

  if (panel) panel.style.display = "block";
  if (titleEl) titleEl.textContent = "Developing…";
  if (durEl)   durEl.textContent   = "…";
  if (metaEl)  metaEl.textContent  = "GPT is building your story breakdown…";
  if (sceneEl) sceneEl.innerHTML   = "";
  if (reelEl)  reelEl.innerHTML    = "";
  if (approveEl) approveEl.textContent = "";
  if (approveBtn) { approveBtn.disabled = true; approveBtn.classList.add("lora-scanning"); }
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });

  const charSel  = document.getElementById("iv-dev-character");
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const minutes  = parseFloat(document.getElementById("iv-minutes")?.value || "8");
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");

  try {
    const res  = await levFetch(`${IV_BASE}/ideas/${id}/develop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_name: charName, target_minutes: minutes, scene_seconds: sceneSec }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Develop failed");
    ivRenderStory(data.story);
    await ivLoadIdeas();
  } catch (err) {
    if (metaEl) metaEl.textContent = "Error: " + err.message;
    if (approveBtn) { approveBtn.disabled = false; approveBtn.classList.remove("lora-scanning"); }
  }
};

// ── Render story ───────────────────────────────────────────────
function ivRenderStory(story) {
  const titleEl   = document.getElementById("iv-story-title");
  const durEl     = document.getElementById("iv-story-duration");
  const metaEl    = document.getElementById("iv-story-meta");
  const sceneEl   = document.getElementById("iv-scene-list");
  const reelEl    = document.getElementById("iv-reel-row");
  const approveBtn = document.getElementById("iv-approve-btn");

  if (titleEl) titleEl.textContent = story.title || "Story Breakdown";

  const estMin = story.est_minutes || 0;
  const estSec = story.est_seconds || 0;
  const m = Math.floor(estMin); const s = Math.round((estMin - m) * 60);
  if (durEl) durEl.textContent = `~${m}m ${s}s`;

  if (metaEl) metaEl.innerHTML = `
    <strong style="color:var(--gold);">${story.title || ""}</strong><br/>
    ${story.logline || ""}<br/><br/>
    <em style="color:rgba(255,255,255,0.5);">${story.act_structure || ""}</em><br/><br/>
    <span style="color:var(--gold);">${story.num_scenes} scenes</span> × ${story.scene_seconds}s
    = <span style="color:var(--gold);">~${m} min ${s}s</span>
    &nbsp;(target: ${story.target_minutes} min)
  `;

  // Reel cuts
  if (reelEl) {
    reelEl.style.display = "flex";
    const reels = [
      { label: "60s Reel", key: "reel_60s", color: "#c9a84c" },
      { label: "30s Reel", key: "reel_30s", color: "#4caf7a" },
      { label: "15s Reel", key: "reel_15s", color: "#4caaff" },
    ];
    reelEl.innerHTML = reels.map(r => {
      const indices = story[r.key] || [];
      if (!indices.length) return "";
      return `<div style="background:rgba(0,0,0,0.4);border:1px solid ${r.color}33;border-radius:3px;padding:4px 8px;font-size:10px;letter-spacing:1px;">
        <span style="color:${r.color};text-transform:uppercase;">${r.label}</span>
        <span style="color:var(--text-dim);margin-left:6px;">Scenes ${indices.map(i => i + 1).join(", ")}</span>
      </div>`;
    }).join("");
  }

  // Scene list
  const scenes = story.scenes || [];
  const reel60  = new Set(story.reel_60s  || []);
  const reel30  = new Set(story.reel_30s  || []);
  const reel15  = new Set(story.reel_15s  || []);

  if (sceneEl) {
    sceneEl.innerHTML = scenes.map((sc, i) => {
      const isReel15 = reel15.has(sc.index ?? i);
      const isReel30 = reel30.has(sc.index ?? i);
      const isReel60 = reel60.has(sc.index ?? i);
      const reelDots = [
        isReel15 ? `<span title="15s reel" style="color:#4caaff;font-size:9px;">●15s</span>` : "",
        isReel30 ? `<span title="30s reel" style="color:#4caf7a;font-size:9px;">●30s</span>` : "",
        isReel60 ? `<span title="60s reel" style="color:#c9a84c;font-size:9px;">●60s</span>` : "",
      ].filter(Boolean).join(" ");
      const actColor = { 1: "rgba(255,100,100,0.5)", 2: "rgba(201,168,76,0.5)", 3: "rgba(100,200,100,0.5)" }[sc.act] || "rgba(255,255,255,0.2)";
      return `
        <div style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${actColor};border-radius:3px;padding:8px 10px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:1px;min-width:28px;">S${(sc.index ?? i) + 1}</span>
            <span style="font-size:9px;color:${actColor.replace("0.5", "0.9")};letter-spacing:1px;text-transform:uppercase;">Act ${sc.act}</span>
            <span style="font-size:9px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">${sc.emotion || ""}</span>
            <span style="margin-left:auto;display:flex;gap:4px;">${reelDots}</span>
            <span style="font-size:9px;color:rgba(255,255,255,0.35);">⚡${sc.reel_weight || 0}</span>
          </div>
          <div style="font-size:12px;color:var(--text);margin-bottom:4px;">${sc.description || ""}</div>
          ${sc.dialogue ? `<div style="font-size:11px;color:var(--gold);font-style:italic;margin-bottom:4px;">"${sc.dialogue}"</div>` : ""}
          <details style="margin-top:4px;">
            <summary style="font-size:10px;color:var(--text-dim);letter-spacing:1px;cursor:pointer;">Image Prompt ▾</summary>
            <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:4px;line-height:1.5;">${sc.image_prompt || ""}</div>
          </details>
        </div>`;
    }).join("");
  }

  if (approveBtn) { approveBtn.disabled = false; approveBtn.classList.remove("lora-scanning"); }
}

// ── Approve & Generate ─────────────────────────────────────────
window.ivApproveAndGenerate = async function ivApproveAndGenerate() {
  if (!ivCurrentIdeaId) return;
  const btn      = document.getElementById("iv-approve-btn");
  const statusEl = document.getElementById("iv-approve-status");
  const charSel  = document.getElementById("iv-dev-character");
  const charId   = charSel?.value || "";
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");
  const model    = "wan21_i2v";

  if (btn) { btn.disabled = true; btn.classList.add("lora-scanning"); }
  if (statusEl) statusEl.textContent = "Approving…";

  try {
    // 1. Mark idea as approved
    const approveRes = await levFetch(`${IV_BASE}/ideas/${ivCurrentIdeaId}/approve`, { method: "POST" });
    if (!approveRes.ok) throw new Error("Approve failed");

    // 2. Fetch story scenes already planned (no GPT re-planning in orchestrator)
    const ideasRes  = await levFetch(`${IV_BASE}/ideas`);
    const ideasData = await ideasRes.json();
    const idea      = (ideasData.ideas || []).find(i => i.id === ivCurrentIdeaId);
    const rawScenes = idea?.story?.scenes || [];

    if (!rawScenes.length) throw new Error("No scenes found — Develop the story first.");

    // 3. Build full scene objects for the orchestrator
    const scenes = rawScenes.map(sc => ({
      description:   sc.description || "",
      image_prompt:  sc.image_prompt || sc.description || "",
      motion_prompt: sc.motion_prompt ||
        `${sc.emotion || "cinematic"} atmosphere, smooth continuous camera movement, ${(sc.description || "").slice(0, 120)}`,
      dialogue:      sc.dialogue || "",
      emotion:       sc.emotion || "",
    }));

    if (statusEl) statusEl.innerHTML =
      `<span style="color:var(--gold);">Launching pipeline — ${scenes.length} scenes…</span>`;

    // 4. Fire orchestrator — passes scenes directly, TTS on, no GPT re-plan
    const orchRes  = await levFetch(`${IV_BASE}/orchestrate/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes,
        character_id:   charId,
        character_name: charName,
        duration:       sceneSec,
        model,
        include_tts:    true,
        project:        charName || idea?.title || "Default",
      }),
    });
    const orchData = await orchRes.json();
    if (!orchData.success) throw new Error(orchData.error || "Orchestrator failed to start");

    const jobId = orchData.job_id;
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
    await ivLoadIdeas();

    // 5. Live progress polling
    ivPollJob(jobId, scenes.length, statusEl);

  } catch (err) {
    if (statusEl) statusEl.textContent = "Error: " + err.message;
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
  }
};

// ── Job progress poller ────────────────────────────────────────
async function ivPollJob(jobId, totalScenes, statusEl) {
  if (!statusEl) return;
  let polls = 0;

  const poll = async () => {
    try {
      const res  = await levFetch(`${IV_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();
      const done    = data.progress || 0;
      const total   = data.total   || totalScenes;
      const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
      const step    = data.step    || "Running…";
      const isDone  = data.status === "complete";
      const isFail  = data.status === "failed";

      statusEl.innerHTML = `
        <div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.45);margin-bottom:3px;">
            <span>${done} / ${total} shots complete</span><span>${pct}%</span>
          </div>
          <div style="background:rgba(255,255,255,0.1);border-radius:2px;height:4px;">
            <div style="background:var(--gold);border-radius:2px;height:4px;width:${pct}%;transition:width 0.5s;"></div>
          </div>
        </div>
        <div style="font-size:11px;letter-spacing:1px;color:${isFail ? "var(--imperial-red)" : isDone ? "#4caf50" : "var(--text-dim)"};">
          ${step}
        </div>
        ${isDone ? `<div style="margin-top:8px;font-size:11px;color:#4caf50;letter-spacing:1px;">✔ Film in Timeline — click <strong>Timeline ↗</strong> in the sidebar to review.</div>` : ""}
        ${isFail ? `<div style="margin-top:4px;font-size:10px;color:var(--imperial-red);">${data.error || ""}</div>` : ""}
      `;

      if (!isDone && !isFail && polls < 360) {
        polls++;
        setTimeout(poll, 5000);
      }
    } catch (_) {
      if (polls < 360) { polls++; setTimeout(poll, 8000); }
    }
  };

  setTimeout(poll, 3000);
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("iv-save-btn")?.addEventListener("click", ivSaveIdea);
  ivLoadCharacters();
  ivLoadIdeas();
});

window.ivDeleteIdea = ivDeleteIdea;

// ─── Idea Vault ───────────────────────────────────────────────
const IV_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let ivCurrentIdeaId  = sessionStorage.getItem("ivCurrentIdeaId") || null;
let ivEditingIdeaId  = null;   // non-null when the capture form is in edit mode
let _ivIdeasCache    = [];     // latest loaded ideas list

function _ivSetCurrentId(id) {
  ivCurrentIdeaId = id;
  if (id) sessionStorage.setItem("ivCurrentIdeaId", id);
  else sessionStorage.removeItem("ivCurrentIdeaId");
}

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
    _ivIdeasCache = ideas;
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
          <div style="display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:9px;color:${statusColor};letter-spacing:1px;text-transform:uppercase;">${idea.status}</span>
            <button onclick="ivEditIdea('${idea.id}')"
              style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
              ✎ Edit
            </button>
            ${idea.story
              ? `<button onclick="ivViewStory('${idea.id}')"
                  style="flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
                  📋 View Story
                </button>
                <button onclick="ivDevelopIdea('${idea.id}')" title="Re-run GPT to regenerate story"
                  style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
                  ↺
                </button>`
              : `<button onclick="ivDevelopIdea('${idea.id}')"
                  style="flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
                  ⚡ Develop Story
                </button>`
            }
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error("IV LOAD ERROR:", err);
    list.innerHTML = `<p style="color:var(--imperial-red);font-size:11px;">Could not load ideas.</p>`;
  }
}

// ── Save / Update ──────────────────────────────────────────────
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

  const payload = {
    title, rawIdea: text, genre,
    target_minutes: minutes, scene_seconds: sceneSec,
    tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
  };

  try {
    let res;
    if (ivEditingIdeaId) {
      // Update existing idea
      res = await levFetch(`${IV_BASE}/ideas/${ivEditingIdeaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      // Create new idea
      res = await levFetch(`${IV_BASE}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, source: "web" }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Save failed");

    ivCancelEdit();
    if (statusEl) statusEl.textContent = ivEditingIdeaId ? `Updated: "${title}"` : `Saved: "${title}"`;
    await ivLoadIdeas();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Failed to save.";
  }
}

// ── Edit ───────────────────────────────────────────────────────
window.ivEditIdea = async function ivEditIdea(id) {
  // Fetch fresh idea data
  let idea = null;
  try {
    const res  = await levFetch(`${IV_BASE}/ideas`);
    const data = await res.json();
    idea = (data.ideas || []).find(i => i.id === id);
  } catch (_) {}
  if (!idea) return;

  // Load into capture form
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ""; };
  set("iv-title",      idea.title     || "");
  set("iv-text",       idea.rawIdea   || "");
  set("iv-genre",      idea.genre     || "sci-fi action");
  set("iv-tags",       (idea.tags || []).join(", "));
  set("iv-minutes",    idea.target_minutes || "8");
  set("iv-scene-sec",  idea.scene_seconds  || "5");

  ivEditingIdeaId = id;

  // Flip save button label and add cancel
  const saveBtn = document.getElementById("iv-save-btn");
  if (saveBtn) {
    saveBtn.textContent = "✔ Update Idea";
    saveBtn.style.background = "rgba(33,150,243,0.3)";
    saveBtn.style.borderColor = "rgba(33,150,243,0.6)";
    saveBtn.style.color = "#90caf9";
  }

  // Insert cancel button if not already there
  if (!document.getElementById("iv-cancel-edit-btn")) {
    const cancel = document.createElement("button");
    cancel.id = "iv-cancel-edit-btn";
    cancel.textContent = "✕ Cancel";
    cancel.onclick = ivCancelEdit;
    cancel.style.cssText = "width:100%;margin-top:4px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:5px;border-radius:2px;cursor:pointer;";
    saveBtn?.parentNode?.insertBefore(cancel, saveBtn.nextSibling);
  }

  // Scroll capture form into view
  document.getElementById("iv-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("iv-title")?.focus();
};

function ivCancelEdit() {
  ivEditingIdeaId = null;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  set("iv-title", ""); set("iv-text", ""); set("iv-tags", "");

  const saveBtn = document.getElementById("iv-save-btn");
  if (saveBtn) {
    saveBtn.textContent = "Save Idea";
    saveBtn.style.background = "";
    saveBtn.style.borderColor = "";
    saveBtn.style.color = "";
  }
  document.getElementById("iv-cancel-edit-btn")?.remove();
  const statusEl = document.getElementById("iv-status");
  if (statusEl) statusEl.textContent = "";
}

// ── Delete ─────────────────────────────────────────────────────
async function ivDeleteIdea(id) {
  try {
    const res = await levFetch(`${IV_BASE}/ideas/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    if (ivCurrentIdeaId === id) {
      const panel = document.getElementById("iv-story-panel");
      if (panel) panel.style.display = "none";
      _ivSetCurrentId(null);
    }
    await ivLoadIdeas();
  } catch (err) {
    console.error("IV DELETE ERROR:", err);
  }
}

// ── View existing story (no API call) ─────────────────────────
window.ivViewStory = function ivViewStory(id) {
  _ivSetCurrentId(id);
  const idea = _ivIdeasCache.find(i => i.id === id);
  if (!idea?.story) { ivDevelopIdea(id); return; }
  const panel = document.getElementById("iv-story-panel");
  if (panel) panel.style.display = "block";
  const approveEl = document.getElementById("iv-approve-status");
  if (approveEl) approveEl.textContent = "";
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  ivRenderStory(idea.story);
};

// ── Develop ────────────────────────────────────────────────────
window.ivDevelopIdea = async function ivDevelopIdea(id) {
  _ivSetCurrentId(id);
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
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`); }
    if (!res.ok || !data.success) throw new Error(data.detail || data.error || "Develop failed");
    ivRenderStory(data.story);
    await ivLoadIdeas();
  } catch (err) {
    if (metaEl) metaEl.textContent = "Error: " + err.message;
    if (approveBtn) { approveBtn.disabled = false; approveBtn.classList.remove("lora-scanning"); }
  }
};

// ── One Shot: develop → approve → generate (no stops) ─────────
window.ivOneShotRun = async function ivOneShotRun(id) {
  _ivSetCurrentId(id);
  const panel     = document.getElementById("iv-story-panel");
  const titleEl   = document.getElementById("iv-story-title");
  const metaEl    = document.getElementById("iv-story-meta");
  const sceneEl   = document.getElementById("iv-scene-list");
  const reelEl    = document.getElementById("iv-reel-row");
  const statusEl  = document.getElementById("iv-approve-status");
  const approveBtn = document.getElementById("iv-approve-btn");

  if (panel) panel.style.display = "block";
  if (titleEl) titleEl.textContent = "One Shot — Writing Story…";
  if (metaEl) metaEl.textContent = "GPT building story breakdown…";
  if (sceneEl) sceneEl.innerHTML = "";
  if (reelEl) reelEl.innerHTML = "";
  if (statusEl) statusEl.textContent = "";
  if (approveBtn) { approveBtn.disabled = true; approveBtn.classList.add("lora-scanning"); }
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });

  const charSel  = document.getElementById("iv-dev-character");
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const minutes  = parseFloat(document.getElementById("iv-minutes")?.value || "2");
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "8");

  try {
    const res  = await levFetch(`${IV_BASE}/ideas/${id}/develop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_name: charName, target_minutes: minutes, scene_seconds: sceneSec }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`); }
    if (!res.ok || !data.success) throw new Error(data.detail || data.error || "Develop failed");

    ivRenderStory(data.story);
    await ivLoadIdeas();

    if (statusEl) statusEl.innerHTML = `<span style="color:var(--gold);letter-spacing:1px;">Story ready — launching pipeline…</span>`;
    await ivApproveAndGenerate();

  } catch (err) {
    if (metaEl) metaEl.textContent = "Error: " + err.message;
    if (approveBtn) { approveBtn.disabled = false; approveBtn.classList.remove("lora-scanning"); }
  }
};

// ── Render story ───────────────────────────────────────────────
function ivRenderStory(story) {
  _ivCurrentStory = story;
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
    const esc = s => (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    sceneEl.innerHTML = scenes.map((sc, i) => {
      const isReel15 = reel15.has(sc.index ?? i);
      const isReel30 = reel30.has(sc.index ?? i);
      const isReel60 = reel60.has(sc.index ?? i);
      const reelDots = [
        isReel15 ? `<span style="color:#4caaff;font-size:9px;">●15s</span>` : "",
        isReel30 ? `<span style="color:#4caf7a;font-size:9px;">●30s</span>` : "",
        isReel60 ? `<span style="color:#c9a84c;font-size:9px;">●60s</span>` : "",
      ].filter(Boolean).join(" ");
      const actColor = { 1: "rgba(255,100,100,0.5)", 2: "rgba(201,168,76,0.5)", 3: "rgba(100,200,100,0.5)" }[sc.act] || "rgba(255,255,255,0.2)";
      return `
        <div data-scene-idx="${i}" style="background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${actColor};border-radius:3px;padding:8px 10px;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:1px;min-width:28px;">S${(sc.index ?? i) + 1}</span>
            <span style="font-size:9px;color:${actColor.replace("0.5", "0.9")};letter-spacing:1px;text-transform:uppercase;">Act ${sc.act}</span>
            <input data-field="emotion" value="${esc(sc.emotion)}"
              style="width:80px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);font-family:Rajdhani,sans-serif;font-size:9px;letter-spacing:1px;text-transform:uppercase;padding:1px 2px;outline:none;"
              placeholder="emotion" />
            <span style="margin-left:auto;display:flex;gap:4px;">${reelDots}</span>
            <button onclick="ivTrimFromScene(${i})" title="Delete this and all after"
              style="background:rgba(180,30,30,0.25);border:1px solid rgba(255,80,80,0.3);color:rgba(255,100,100,0.7);font-size:9px;letter-spacing:1px;padding:2px 5px;border-radius:2px;cursor:pointer;font-family:Rajdhani,sans-serif;text-transform:uppercase;">
              ✂
            </button>
            <button onclick="ivAddScene(${i})" title="Insert scene after this one"
              style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.35);font-size:10px;padding:2px 6px;border-radius:2px;cursor:pointer;">
              +
            </button>
            <button onclick="ivDeleteScene(${i})" title="Delete this scene only"
              style="background:rgba(80,0,0,0.3);border:1px solid rgba(255,60,60,0.25);color:rgba(255,80,80,0.6);font-size:10px;padding:2px 6px;border-radius:2px;cursor:pointer;">
              ✕
            </button>
          </div>
          <textarea data-field="description" rows="2"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:2px;color:var(--text);font-family:Rajdhani,sans-serif;font-size:12px;padding:4px 6px;resize:vertical;outline:none;margin-bottom:4px;"
            >${esc(sc.description)}</textarea>
          <textarea data-field="dialogue" rows="2"
            style="width:100%;box-sizing:border-box;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:2px;color:var(--gold);font-family:Rajdhani,sans-serif;font-style:italic;font-size:11px;padding:4px 6px;resize:vertical;outline:none;margin-bottom:4px;"
            placeholder="dialogue / lyric line"
            >${esc(sc.dialogue)}</textarea>
          <details style="margin-top:2px;">
            <summary style="font-size:10px;color:var(--text-dim);letter-spacing:1px;cursor:pointer;">Image Prompt ▾</summary>
            <textarea data-field="image_prompt" rows="3"
              style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:2px;color:rgba(255,255,255,0.45);font-family:Rajdhani,sans-serif;font-size:10px;padding:4px 6px;resize:vertical;outline:none;margin-top:4px;"
              >${esc(sc.image_prompt)}</textarea>
          </details>
        </div>`;
    }).join("");
  }

  if (approveBtn) { approveBtn.disabled = false; approveBtn.classList.remove("lora-scanning"); }
}

// ── Save scene edits from DOM ──────────────────────────────────
window.ivSaveSceneEdits = async function ivSaveSceneEdits() {
  const saveBtn = document.querySelector("[onclick='ivSaveSceneEdits()']");
  const showStatus = (msg, color) => {
    if (saveBtn) { saveBtn.textContent = msg; saveBtn.style.color = color; }
  };

  if (!ivCurrentIdeaId) {
    showStatus("⚠ Open a story first", "var(--imperial-red)");
    setTimeout(() => { if (saveBtn) { saveBtn.textContent = "💾 Save Edits"; saveBtn.style.color = "var(--gold)"; } }, 3000);
    return;
  }

  const sceneEl = document.getElementById("iv-scene-list");
  if (!sceneEl) return;
  const cards = sceneEl.querySelectorAll("[data-scene-idx]");
  if (!cards.length) { showStatus("⚠ No scenes", "var(--imperial-red)"); return; }

  showStatus("Saving…", "rgba(255,255,255,0.6)");

  // Build scenes from DOM — don't rely on _ivCurrentStory being populated
  const scenes = [];
  cards.forEach(card => {
    const idx = parseInt(card.dataset.sceneIdx);
    const get = f => card.querySelector(`[data-field="${f}"]`)?.value?.trim() ?? "";
    const existing = _ivCurrentStory?.scenes?.[idx] || {};
    scenes.push({ ...existing, index: idx,
      description:  get("description"),
      dialogue:     get("dialogue"),
      emotion:      get("emotion"),
      image_prompt: get("image_prompt") });
  });

  try {
    const res = await levFetch(`${IV_BASE}/ideas/${ivCurrentIdeaId}/story`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || data.error || "Save failed");

    // Update in-memory cache without re-rendering (preserves scroll + focus)
    if (_ivCurrentStory) _ivCurrentStory = { ..._ivCurrentStory, scenes };
    showStatus("✔ Saved", "#4caf50");
    setTimeout(() => { if (saveBtn) { saveBtn.textContent = "💾 Save Edits"; saveBtn.style.color = "var(--gold)"; } }, 2000);
  } catch (err) {
    showStatus("✕ " + err.message, "var(--imperial-red)");
    setTimeout(() => { if (saveBtn) { saveBtn.textContent = "💾 Save Edits"; saveBtn.style.color = "var(--gold)"; } }, 4000);
  }
};

// ── Scene delete / trim ────────────────────────────────────────
let _ivCurrentStory = null;

function _ivGetCurrentStoryFromDOM() {
  const sceneEls = document.querySelectorAll("#iv-scene-list [data-scene-idx]");
  return _ivCurrentStory;
}

async function _ivPatchScenes(newScenes) {
  if (!ivCurrentIdeaId) return;
  newScenes = newScenes.map((sc, i) => ({ ...sc, index: i }));
  const secPer = _ivCurrentStory?.scene_seconds || 8;
  const updated = { ...(_ivCurrentStory || {}), scenes: newScenes,
    num_scenes: newScenes.length,
    est_seconds: newScenes.length * secPer,
    est_minutes: parseFloat((newScenes.length * secPer / 60).toFixed(1)) };
  try {
    const res = await levFetch(`${IV_BASE}/ideas/${ivCurrentIdeaId}/story`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes: newScenes, num_scenes: updated.num_scenes,
        est_seconds: updated.est_seconds, est_minutes: updated.est_minutes }),
    });
    if (!res.ok) throw new Error("Patch failed");
    _ivCurrentStory = updated;
    // Full re-render only for structural changes (add/delete/trim)
    ivRenderStory(_ivCurrentStory);
  } catch (err) {
    const metaEl = document.getElementById("iv-story-meta");
    if (metaEl) metaEl.insertAdjacentHTML("beforeend",
      `<div style="color:var(--imperial-red);font-size:11px;margin-top:4px;">Save failed: ${err.message}</div>`);
  }
}

window.ivDeleteScene = async function ivDeleteScene(idx) {
  if (!_ivCurrentStory) return;
  const scenes = [...(_ivCurrentStory.scenes || [])];
  scenes.splice(idx, 1);
  await _ivPatchScenes(scenes);
};

window.ivTrimFromScene = async function ivTrimFromScene(idx) {
  if (!_ivCurrentStory) return;
  const scenes = (_ivCurrentStory.scenes || []).slice(0, idx);
  await _ivPatchScenes(scenes);
};

window.ivAddScene = async function ivAddScene(afterIdx) {
  if (!_ivCurrentStory) return;
  // Save any pending edits first so we don't lose in-progress text
  await ivSaveSceneEdits();
  const scenes = [...(_ivCurrentStory.scenes || [])];
  const insertAt = (afterIdx !== undefined) ? afterIdx + 1 : scenes.length;
  const blank = { index: insertAt, act: scenes[insertAt - 1]?.act || 3,
    description: "", dialogue: "", emotion: "tension", image_prompt: "", reel_weight: 5 };
  scenes.splice(insertAt, 0, blank);
  await _ivPatchScenes(scenes);
};

// ── Approve & Generate ─────────────────────────────────────────
window.ivApproveAndGenerate = async function ivApproveAndGenerate() {
  if (!ivCurrentIdeaId) return;
  const btn      = document.getElementById("iv-approve-btn");
  const statusEl = document.getElementById("iv-approve-status");
  const charSel  = document.getElementById("iv-dev-character");
  const charId   = charSel?.value || "";
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");
  const model    = "ws_wan22";

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

// ── Cost estimator ─────────────────────────────────────────────
const IV_MODEL_COSTS = {
  "ws_wan22":      { label: "Wan 2.2 ⚡",     cost: 0.05, note: "~$0.05/5s clip — WaveSpeed" },
  "ws_wan27":      { label: "Wan 2.7 ⚡",     cost: 0.05, note: "~$0.05/5s clip — WaveSpeed latest" },
  "kling_26":      { label: "Kling 2.6 Pro",  cost: 0.28, note: "~$0.28/5s clip — production" },
};

window.ivUpdateCostEst = function ivUpdateCostEst() {
  const model   = document.getElementById("iv-model")?.value || "ws_wan22";
  const estEl   = document.getElementById("iv-cost-est");
  const sceneEl = document.getElementById("iv-scene-list");
  if (!estEl) return;
  const info      = IV_MODEL_COSTS[model] || { cost: 0, note: "unknown" };
  const numScenes = sceneEl ? sceneEl.children.length : 0;
  const total     = numScenes && info.cost ? `~$${(numScenes * info.cost).toFixed(2)} for ${numScenes} shots` : (info.cost === 0 ? "Free" : info.note);
  estEl.textContent = `${IV_MODEL_COSTS[model]?.label || model} — ${total}`;
};

// ── Keyframes-first flow ───────────────────────────────────────
let _ivKeyframeShots = [];   // stored after keyframes job completes

window.ivGenerateKeyframes = async function ivGenerateKeyframes() {
  if (!ivCurrentIdeaId) return;
  const btn      = document.getElementById("iv-keyframe-btn");
  const statusEl = document.getElementById("iv-approve-status");
  const charSel  = document.getElementById("iv-dev-character");
  const charId   = charSel?.value || "";
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");

  if (btn) { btn.disabled = true; btn.classList.add("lora-scanning"); }

  try {
    const approveRes = await levFetch(`${IV_BASE}/ideas/${ivCurrentIdeaId}/approve`, { method: "POST" });
    if (!approveRes.ok) throw new Error("Approve failed");

    const ideasRes  = await levFetch(`${IV_BASE}/ideas`);
    const ideasData = await ideasRes.json();
    const idea      = (ideasData.ideas || []).find(i => i.id === ivCurrentIdeaId);
    const rawScenes = idea?.story?.scenes || [];
    if (!rawScenes.length) throw new Error("No scenes — develop story first.");

    const scenes = rawScenes.map(sc => ({
      description:   sc.description || "",
      image_prompt:  sc.image_prompt || sc.description || "",
      motion_prompt: sc.motion_prompt || `${sc.emotion || "cinematic"} atmosphere, smooth camera`,
      dialogue:      sc.dialogue || "",
      emotion:       sc.emotion || "",
    }));

    const orchRes  = await levFetch(`${IV_BASE}/orchestrate/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes, character_id: charId, character_name: charName,
        duration: sceneSec, model: "ws_wan22", keyframes_only: true,
        project: charName || idea?.title || "Default",
      }),
    });
    const orchData = await orchRes.json();
    if (!orchData.success) throw new Error(orchData.error || "Failed to start");

    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }

    // Poll — when keyframes_ready, show review UI
    ivPollKeyframeJob(orchData.job_id, scenes.length, statusEl, rawScenes);
  } catch (err) {
    if (statusEl) statusEl.textContent = "Error: " + err.message;
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
  }
};

async function ivPollKeyframeJob(jobId, totalScenes, statusEl, rawScenes) {
  if (!statusEl) return;
  let polls = 0;

  const poll = async () => {
    try {
      const res  = await levFetch(`${IV_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();
      const done  = data.progress || 0;
      const total = data.total   || totalScenes;
      const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

      statusEl.innerHTML = `
        <div style="margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,0.45);margin-bottom:2px;">
            <span>${done}/${total} keyframes</span><span>${pct}%</span>
          </div>
          <div style="background:rgba(255,255,255,0.1);border-radius:2px;height:3px;">
            <div style="background:var(--gold);border-radius:2px;height:3px;width:${pct}%;transition:width 0.4s;"></div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-dim);">${data.step || "Generating keyframes…"}</div>
      `;

      if (data.status === "keyframes_ready") {
        _ivKeyframeShots = data.shots || [];
        ivShowKeyframeReview(_ivKeyframeShots, rawScenes);
        statusEl.innerHTML = `<span style="color:#4caf50;">✔ ${_ivKeyframeShots.length} keyframes ready — review and select which to animate</span>`;
        return;
      }
      if (data.status === "failed") {
        statusEl.innerHTML = `<span style="color:var(--imperial-red);">⚠ ${data.step}</span>`;
        return;
      }
      if (polls < 360) { polls++; setTimeout(poll, 5000); }
    } catch (_) {
      if (polls < 360) { polls++; setTimeout(poll, 8000); }
    }
  };
  setTimeout(poll, 3000);
}

function ivShowKeyframeReview(shots, rawScenes) {
  const sceneEl   = document.getElementById("iv-scene-list");
  const animateBar = document.getElementById("iv-animate-bar");
  if (!sceneEl) return;

  // Rebuild scene list with actual keyframe images + approve checkboxes
  sceneEl.innerHTML = shots.map((shot, i) => {
    const imgUrl = shot.renderOutputUrl || shot.imageUrl || "";
    const raw    = rawScenes[i] || {};
    const actColor = { 1: "rgba(255,100,100,0.5)", 2: "rgba(201,168,76,0.5)", 3: "rgba(100,200,100,0.5)" }[raw.act] || "rgba(255,255,255,0.15)";
    return `
      <div id="iv-kf-${i}" data-approved="true" onclick="ivToggleKeyframe(${i})"
        style="cursor:pointer;background:rgba(0,0,0,0.4);border:2px solid var(--gold);border-left:4px solid ${actColor};border-radius:3px;padding:8px;display:flex;gap:10px;align-items:flex-start;transition:border-color 0.15s;">
        ${imgUrl ? `<img src="${imgUrl}" style="width:80px;height:50px;object-fit:cover;border-radius:2px;flex-shrink:0;border:1px solid rgba(255,255,255,0.1);" />` : `<div style="width:80px;height:50px;background:rgba(255,255,255,0.05);border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9px;color:rgba(255,255,255,0.3);">No image</div>`}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:1px;">S${i+1}</span>
            <span class="iv-kf-check-${i}" style="font-size:11px;color:#4caf50;">✔ Selected</span>
          </div>
          <div style="font-size:11px;color:var(--text);line-height:1.4;">${raw.description || shot.shotDesc || ""}</div>
          ${raw.dialogue ? `<div style="font-size:10px;color:var(--gold);font-style:italic;margin-top:3px;">"${raw.dialogue}"</div>` : ""}
        </div>
      </div>`;
  }).join("");

  if (animateBar) animateBar.style.display = "block";
  // Update animate button label with model
  const animBtn = document.getElementById("iv-animate-selected-btn");
  const model   = document.getElementById("iv-model")?.value || "kling_26";
  const minfo   = IV_MODEL_COSTS[model] || {};
  if (animBtn) animBtn.textContent = `🎬 Animate Selected with ${minfo.label || model}`;
}

window.ivToggleKeyframe = function ivToggleKeyframe(i) {
  const card = document.getElementById(`iv-kf-${i}`);
  if (!card) return;
  const approved = card.dataset.approved === "true";
  card.dataset.approved = approved ? "false" : "true";
  card.style.borderColor = approved ? "rgba(255,255,255,0.15)" : "var(--gold)";
  card.style.opacity     = approved ? "0.45" : "1";
  const label = card.querySelector(`.iv-kf-check-${i}`);
  if (label) { label.textContent = approved ? "✕ Skipped" : "✔ Selected"; label.style.color = approved ? "rgba(255,255,255,0.3)" : "#4caf50"; }
};

window.ivSelectAllKeyframes = function ivSelectAllKeyframes(select) {
  _ivKeyframeShots.forEach((_, i) => {
    const card = document.getElementById(`iv-kf-${i}`);
    if (!card) return;
    card.dataset.approved = select ? "true" : "false";
    card.style.borderColor = select ? "var(--gold)" : "rgba(255,255,255,0.15)";
    card.style.opacity     = select ? "1" : "0.45";
    const label = card.querySelector(`.iv-kf-check-${i}`);
    if (label) { label.textContent = select ? "✔ Selected" : "✕ Skipped"; label.style.color = select ? "#4caf50" : "rgba(255,255,255,0.3)"; }
  });
};

window.ivAnimateSelected = async function ivAnimateSelected() {
  const btn      = document.getElementById("iv-animate-selected-btn");
  const statusEl = document.getElementById("iv-approve-status");
  const charSel  = document.getElementById("iv-dev-character");
  const charId   = charSel?.value || "";
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "";
  const model    = document.getElementById("iv-model")?.value || "kling_26";
  const sceneSec = parseInt(document.getElementById("iv-scene-sec")?.value || "5");

  const approved = _ivKeyframeShots.filter((_, i) => {
    const card = document.getElementById(`iv-kf-${i}`);
    return card?.dataset.approved !== "false";
  });

  if (!approved.length) { if (statusEl) statusEl.textContent = "No shots selected."; return; }
  if (btn) { btn.disabled = true; btn.classList.add("lora-scanning"); }
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--gold);">Sending ${approved.length} shots to ${model}…</span>`;

  try {
    const res  = await levFetch(`${IV_BASE}/orchestrate/reanimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shots: approved.map(s => ({
          id:            s.id,
          image_url:     s.renderOutputUrl || s.imageUrl || "",
          motion_prompt: s.motion_prompt || `cinematic motion, smooth camera`,
          dialogue:      s.dialogue || "",
          project:       s.project || charName || "",
        })),
        model, duration: sceneSec,
        character_id: charId, character_name: charName,
        include_tts: true,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Reanimate failed");
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
    ivPollJob(data.job_id, approved.length, statusEl);
  } catch (err) {
    if (statusEl) statusEl.textContent = "Error: " + err.message;
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); }
  }
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("iv-save-btn")?.addEventListener("click", ivSaveIdea);

  // Auto-grow textarea as you type
  const ta = document.getElementById("iv-text");
  if (ta) {
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.max(260, ta.scrollHeight) + "px";
    });
  }

  ivLoadCharacters();
  ivLoadIdeas();
  ivUpdateCostEst();
});

window.ivDeleteIdea  = ivDeleteIdea;
window.ivCancelEdit  = ivCancelEdit;

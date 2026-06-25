// ─── Idea Vault ───────────────────────────────────────────────
const IV_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let ivCurrentIdeaId  = sessionStorage.getItem("ivCurrentIdeaId") || null;
let ivEditingIdeaId  = null;
let _ivIdeasCache    = [];

function _ivSetCurrentId(id) {
  ivCurrentIdeaId = id;
  if (id) sessionStorage.setItem("ivCurrentIdeaId", id);
  else sessionStorage.removeItem("ivCurrentIdeaId");
}

// ── Shared active-character store (persists across tabs via localStorage) ──
window.LEVRAM_CHAR = {
  getId:   ()      => localStorage.getItem("levram_active_char_id") || "",
  getName: ()      => localStorage.getItem("levram_active_char_name") || "",
  set:     (id, name) => {
    if (id) { localStorage.setItem("levram_active_char_id", id); localStorage.setItem("levram_active_char_name", name || ""); }
    else     { localStorage.removeItem("levram_active_char_id"); localStorage.removeItem("levram_active_char_name"); }
    document.querySelectorAll("select[data-char-sync]").forEach(s => { if (s.value !== id) s.value = id; });
  },
};

// ── Genre-aware defaults for target length / scene pacing ────────
const _RL_GENRES = new Set(["adult","erotic","explicit","xxx","nsfw","lesbian","sapphic","wlw"]);
function _ivApplyGenreDefaults(genre) {
  const words   = (genre || "").toLowerCase().split(/[\s,]+/);
  const isAdult = words.some(w => _RL_GENRES.has(w));
  const minSel  = document.getElementById("iv-minutes");
  const secSel  = document.getElementById("iv-scene-sec");
  if (minSel && !minSel.dataset.userSet) minSel.value = isAdult ? "5" : "8";
  if (secSel && !secSel.dataset.userSet) secSel.value = isAdult ? "8" : "5";
}

document.addEventListener("DOMContentLoaded", () => {
  ["iv-minutes", "iv-scene-sec"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", e => {
      e.target.dataset.userSet = "1";
    });
  });
  document.getElementById("iv-genre")?.addEventListener("input", e => {
    _ivApplyGenreDefaults(e.target.value);
  });
});

// ── Load character dropdowns (Char 1 + Char 2) ────────────────
let _ivCharLoading = false;
async function ivLoadCharacters() {
  if (_ivCharLoading) return;
  _ivCharLoading = true;
  const sel  = document.getElementById("iv-dev-character");
  const sel2 = document.getElementById("iv-dev-character2");
  if (!sel) { _ivCharLoading = false; return; }
  sel.innerHTML  = `<option value="">None / Original</option>`;
  if (sel2) sel2.innerHTML = `<option value="">None</option>`;
  try {
    const res  = await levFetch(`${IV_BASE}/characters`);
    const data = await res.json();
    (data.characters || []).forEach(c => {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.name; o.dataset.name = c.name;
      sel.appendChild(o);
      if (sel2) {
        const o2 = document.createElement("option");
        o2.value = c.id; o2.textContent = c.name; o2.dataset.name = c.name;
        sel2.appendChild(o2);
      }
    });
    const saved = LEVRAM_CHAR.getId();
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
  } catch (err) {
    console.warn("[IV] ivLoadCharacters failed:", err);
    if (sel) sel.innerHTML = `<option value="">Could not load characters</option>`;
  } finally {
    _ivCharLoading = false;
  }
}

// ── Load location dropdown ────────────────────────────────────
async function ivLoadLocations() {
  const sel = document.getElementById("iv-dev-location");
  if (!sel) return;
  sel.innerHTML = `<option value="">None — AI chooses</option>`;
  try {
    const res  = await levFetch(`${IV_BASE}/locations`);
    const data = await res.json();
    (data.locations || []).forEach(loc => {
      const o = document.createElement("option");
      o.value = loc.name; o.textContent = loc.name;
      sel.appendChild(o);
    });
  } catch (err) {
    console.warn("[IV] ivLoadLocations failed:", err);
  }
}

// ── Idea list ──────────────────────────────────────────────────
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
      const sbLink  = `storyboard.html?project=${encodeURIComponent(idea.title || "")}`;
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
              ? `<a href="${sbLink}"
                  style="flex:1;display:inline-block;text-align:center;background:rgba(33,150,243,0.12);border:1px solid rgba(33,150,243,0.4);color:#90caf9;font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 8px;border-radius:2px;text-decoration:none;">
                  → Storyboard
                </a>
                <button id="iv-dev-btn-${idea.id}" onclick="ivDevelopIdea('${idea.id}')" title="Re-develop story"
                  style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
                  ↺
                </button>`
              : `<button id="iv-dev-btn-${idea.id}" onclick="ivDevelopIdea('${idea.id}')"
                  style="flex:1;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 8px;border-radius:2px;cursor:pointer;">
                  ⚡ Develop Story
                </button>`
            }
          </div>
          <div id="iv-card-status-${idea.id}" style="font-size:10px;color:rgba(255,255,255,0.4);min-height:0;padding-top:0;"></div>
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
      res = await levFetch(`${IV_BASE}/ideas/${ivEditingIdeaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
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
    localStorage.setItem("levram_active_project", title);
    window.refreshBattery?.();
    await ivLoadIdeas();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Failed to save.";
  }
}

// ── Edit ───────────────────────────────────────────────────────
window.ivEditIdea = async function ivEditIdea(id) {
  let idea = null;
  try {
    const res  = await levFetch(`${IV_BASE}/ideas`);
    const data = await res.json();
    idea = (data.ideas || []).find(i => i.id === id);
  } catch (_) {}
  if (!idea) return;

  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ""; };
  set("iv-title",  idea.title     || "");
  set("iv-text",   idea.rawIdea   || "");
  set("iv-genre",  idea.genre     || "sci-fi action");
  set("iv-tags",   (idea.tags || []).join(", "));
  _ivApplyGenreDefaults(idea.genre || "");
  if (idea.target_minutes) set("iv-minutes",   idea.target_minutes);
  if (idea.scene_seconds)  set("iv-scene-sec", idea.scene_seconds);

  if (idea.title) {
    localStorage.setItem("levram_active_project", idea.title);
    window.refreshBattery?.();
  }

  ivEditingIdeaId = id;

  const saveBtn = document.getElementById("iv-save-btn");
  if (saveBtn) {
    saveBtn.textContent = "✔ Update Idea";
    saveBtn.style.background = "rgba(33,150,243,0.3)";
    saveBtn.style.borderColor = "rgba(33,150,243,0.6)";
    saveBtn.style.color = "#90caf9";
  }

  if (!document.getElementById("iv-cancel-edit-btn")) {
    const cancel = document.createElement("button");
    cancel.id = "iv-cancel-edit-btn";
    cancel.textContent = "✕ Cancel";
    cancel.onclick = ivCancelEdit;
    cancel.style.cssText = "width:100%;margin-top:4px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:5px;border-radius:2px;cursor:pointer;";
    saveBtn?.parentNode?.insertBefore(cancel, saveBtn.nextSibling);
  }

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
    if (ivCurrentIdeaId === id) _ivSetCurrentId(null);
    await ivLoadIdeas();
  } catch (err) {
    console.error("IV DELETE ERROR:", err);
  }
}

// ── Develop ────────────────────────────────────────────────────
window.ivDevelopIdea = async function ivDevelopIdea(id) {
  _ivSetCurrentId(id);

  const btn      = document.getElementById(`iv-dev-btn-${id}`);
  const cardStat = document.getElementById(`iv-card-status-${id}`);
  const formStat = document.getElementById("iv-status");

  const _setStatus = (label, color = "rgba(201,168,76,0.7)") => {
    if (btn) { btn.textContent = label.length > 22 ? label.slice(0, 22) + "…" : label; btn.disabled = true; btn.style.opacity = "0.6"; }
    if (cardStat) { cardStat.style.color = color; cardStat.textContent = label; cardStat.style.paddingTop = "4px"; }
    if (formStat) formStat.textContent = label;
  };
  const _clearBtn = () => {
    if (btn) { btn.textContent = "Develop Story"; btn.disabled = false; btn.style.opacity = ""; }
  };

  _setStatus("Queuing…");

  const charSel   = document.getElementById("iv-dev-character");
  const charSel2  = document.getElementById("iv-dev-character2");
  const charName  = charSel?.selectedOptions?.[0]?.dataset?.name  || charSel?.selectedOptions?.[0]?.textContent  || "";
  const charId    = charSel?.value || "";
  const char2Name = charSel2?.selectedOptions?.[0]?.dataset?.name || charSel2?.selectedOptions?.[0]?.textContent || "";
  const char2Id   = charSel2?.value || "";
  const locName   = document.getElementById("iv-dev-location")?.value || "";

  const cachedIdea = (_ivIdeasCache || []).find(i => i.id === id);
  const minutes    = cachedIdea?.target_minutes || parseFloat(document.getElementById("iv-minutes")?.value || "8");
  const sceneSec   = parseInt(cachedIdea?.scene_seconds || document.getElementById("iv-scene-sec")?.value || "5");

  try {
    const res  = await levFetch(`${IV_BASE}/ideas/${id}/develop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character_name: charName, character_id: charId,
        character2_name: char2Name, character2_id: char2Id,
        location_name: locName,
        target_minutes: minutes, scene_seconds: sceneSec,
      }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`); }
    if (!res.ok || !data.success) throw new Error(data.detail || data.error || "Develop failed");

    const jobId = data.job_id;
    _setStatus("Starting…");

    // Poll for real backend progress — status stored on the idea document, visible to any worker
    let attempts = 0;
    let startingStreak = 0; // how many consecutive "starting" responses (cross-worker detection)
    const MAX = 300; // 10 min at 2s interval
    while (attempts < MAX) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      try {
        const sRes  = await levFetch(`${IV_BASE}/ideas/develop-status/${jobId}`);
        const sData = await sRes.json();

        if (sData.status === "complete") {
          const sceneCount = sData.scene_count || 0;
          const title      = sData.story_title || "";
          const proj       = encodeURIComponent(title);
          const sbHref     = `storyboard.html?project=${proj}`;
          if (cardStat) {
            cardStat.style.color = "#4caf50";
            cardStat.innerHTML   = `✓ ${sceneCount} scenes &nbsp;<a href="${sbHref}" style="color:#c9a84c;font-weight:700;text-decoration:none;border-bottom:1px solid rgba(201,168,76,0.4);padding-bottom:1px;">→ Open Storyboard</a>`;
          }
          if (formStat) formStat.innerHTML = `<span style="color:#4caf50;">✓ ${sceneCount} scenes built</span>`;
          if (title) localStorage.setItem("levram_active_project", title);
          _clearBtn();
          window.refreshBattery?.();
          await ivLoadIdeas();
          break;
        } else if (sData.status === "failed") {
          throw new Error(sData.error || "Development failed");
        } else if (sData.status === "starting") {
          startingStreak++;
          // After 10s stuck on "starting", the worker handling polls likely isn't the one running the task
          _setStatus(startingStreak >= 5 ? "Working (cross-worker)…" : (sData.step || "Starting…"));
        } else {
          startingStreak = 0;
          _setStatus(sData.step || "Working…");
        }
      } catch (pollErr) {
        if (pollErr.message?.startsWith("Development failed") || pollErr.message?.startsWith("Error:")) {
          throw pollErr;
        }
      }
    }
    if (attempts >= MAX) throw new Error("Timed out after 10 minutes");
  } catch (err) {
    if (cardStat) { cardStat.style.color = "var(--imperial-red)"; cardStat.textContent = "Error: " + err.message; }
    if (formStat) formStat.textContent = "Error: " + err.message;
    _clearBtn();
  }
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("iv-save-btn")?.addEventListener("click", ivSaveIdea);

  const ta = document.getElementById("iv-text");
  if (ta) {
    ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = Math.max(260, ta.scrollHeight) + "px";
    });
  }

  ivLoadCharacters();
  ivLoadLocations();
  ivLoadIdeas();
});

window.ivDeleteIdea = ivDeleteIdea;
window.ivCancelEdit = ivCancelEdit;

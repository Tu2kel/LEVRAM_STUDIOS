const BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

// PHASE 8F.4 — track which character is being edited (null = new)
let editingCharacterId = null;

function getCharacterFormData() {
  const activeSourceBtn = document.querySelector(".cl-vtoggle-btn.active");
  const voiceSource = activeSourceBtn?.dataset.source || "edge_tts";
  const activeRvcSub = document.querySelector(".cl-rvc-sub.active");
  const selectedRvcModel = document.getElementById("rvc-model-select")?.value || "";

  return {
    name: document.getElementById("character-name")?.value || "",
    gender: document.getElementById("character-gender")?.value || "",
    age: document.getElementById("character-age")?.value || "",
    appearance: document.getElementById("character-appearance")?.value || "",
    wardrobe: document.getElementById("character-wardrobe")?.value || "",
    voice: document.getElementById("character-voice")?.value || "",
    default_voice_profile: document.getElementById("character-default-voice")?.value || "",
    personality: document.getElementById("character-personality")?.value || "",
    notes: document.getElementById("character-notes")?.value || "",
    voice_source: voiceSource,
    elevenlabs_voice_id: document.getElementById("el-voice-id")?.value || "",
    rvc_model_path: selectedRvcModel,
    rvc_index_path: "",
    rvc_source_type: activeRvcSub?.dataset.rvcType || "pretrained",
    default_fx_preset: document.getElementById("character-fx-preset")?.value || "clean",
  };
}

function buildCharacterImagePrompt(character) {
  // flux-pulid locks the face from the reference photo — prompt handles outfit + scene only
  return [
    character.wardrobe,
    character.notes,
    "photorealistic, dramatic lighting, cinematic"
  ].filter(Boolean).join(", ");
}

async function generateCharacterPreview() {
  const status    = document.getElementById("character-preview-status");
  const promptBox = document.getElementById("character-preview-prompt");
  const img       = document.getElementById("character-preview-img");
  const btn       = document.getElementById("generate-character-preview-btn");

  const character = getCharacterFormData();
  if (editingCharacterId) character.id = editingCharacterId;
  const prompt = buildCharacterImagePrompt(character);

  if (promptBox) promptBox.value = prompt;
  if (img) img.style.display = "none";
  if (status) status.innerHTML = `Generating<span class="lora-dot">.</span><span class="lora-dot">.</span><span class="lora-dot">.</span>`;
  if (btn) { btn.disabled = true; btn.classList.add("lora-scanning"); btn.textContent = "GENERATING..."; }

  const _done = () => {
    if (btn) { btn.disabled = false; btn.classList.remove("lora-scanning"); btn.textContent = "Generate Character Preview"; }
  };

  try {
    const res = await levFetch(`${BASE}/character-lab/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, prompt })
    });

    const data = await res.json();

    if (data.training) {
      _done();
      if (status) status.textContent = "⏳ " + (data.message || "LoRA training in progress — wait for it to complete.");
      return;
    }

    if (!data.success || data.error) {
      _done();
      if (status) status.textContent = "ERROR: " + (data.error || "Backend failed — check Railway logs.");
      return;
    }

    const imageUrl =
      data.image_url ||
      data.url ||
      data.output_url ||
      data.preview_url ||
      data?.data?.outputUrl ||
      data?.data?.renderOutputUrl ||
      data?.data?.image_url ||
      data?.data?.url;

    if (!res.ok || !imageUrl) {
      _done();
      if (status) status.textContent = "NO IMAGE URL RETURNED — CHECK BACKEND RESPONSE";
      return;
    }

    const finalUrl = imageUrl.startsWith("http") ? imageUrl : `${BASE}${imageUrl}`;

    if (!img) {
      if (status) status.textContent = `IMAGE GENERATED: ${finalUrl}`;
      return;
    }

    img.onerror = () => {
      _done();
      if (status) status.textContent = `IMAGE URL RETURNED BUT FILE NOT SERVED: ${finalUrl}`;
    };

    img.onload = () => {
      _done();
      if (status) status.textContent = "CHARACTER PREVIEW LOADED ✔";
    };

    img.src = finalUrl;
    img.style.display = "block";

    // Persist preview image URL as relative path (strip host so it works on Railway)
    if (editingCharacterId) {
      try {
        const cache = window.LEVRAM_CHARACTERS_CACHE || [];
        const existing = cache.find(c => c.id === editingCharacterId);
        if (existing) {
          const relativePath = finalUrl.startsWith("http")
            ? finalUrl.replace(/^https?:\/\/[^/]+/, "")
            : finalUrl;
          const payload = { ...existing, reference_image_url: relativePath };
          await levFetch(`${BASE}/characters/${editingCharacterId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          await loadCharacters();
        }
      } catch (saveErr) {
        console.error("Could not save reference image to character:", saveErr);
      }
    }
  } catch (err) {
    _done();
    console.error("CHARACTER PREVIEW ERROR:", err);
    if (status) status.textContent = "ERROR — " + (err?.message || "check console");
  }
}

window.saveCharacter = async function saveCharacter() {
  const character = getCharacterFormData();
  // PHASE 8F.4 — always default empty string, never undefined
  character.default_voice_profile = character.default_voice_profile || "";

  const status = document.getElementById("character-lab-status");
  const saveBtn = document.getElementById("save-character-btn");

  if (saveBtn) saveBtn.textContent = "SENDING...";

  // PHASE 8F.4 — use PUT when editing existing, POST for new
  const isEdit = Boolean(editingCharacterId);
  const url = isEdit ? `${BASE}/characters/${editingCharacterId}` : `${BASE}/characters`;
  const method = isEdit ? "PUT" : "POST";

  try {
    const res = await levFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(character)
    });

    const data = await res.json();

    if (!res.ok) {
      if (saveBtn) saveBtn.textContent = "SAVE FAILED";
      if (status) {
        status.style.display = "block";
        status.textContent = "SAVE FAILED — BACKEND REJECTED";
      }
      return;
    }

    // Stay in edit mode with the saved/returned ID so uploads work immediately
    editingCharacterId = data.character?.id || editingCharacterId;
    const badge = document.getElementById("cl-edit-badge");
    if (badge) badge.style.display = editingCharacterId ? "inline-block" : "none";

    if (saveBtn) {
      saveBtn.classList.add("character-save-confirmed");
      saveBtn.textContent = "BACKEND RECEIVED ✔";
      setTimeout(() => {
        saveBtn.classList.remove("character-save-confirmed");
        saveBtn.textContent = "Save Character";
      }, 2500);
    }

    if (status) {
      status.style.display = "block";
      status.innerHTML = `
        ⚜ BACKEND RECEIVED ⚜<br>
        ${character.name || "Unnamed Character"}<br>
        ${new Date().toLocaleTimeString()}
      `;
    }

    await loadCharacters();
  } catch (err) {
    console.error("SAVE CHARACTER ERROR:", err);
    if (saveBtn) saveBtn.textContent = "SAVE ERROR";
    if (status) {
      status.style.display = "block";
      status.textContent = "SAVE ERROR — CHECK CONSOLE";
    }
  }
};

async function loadCharacters() {
  // PHASE 8F.4 — works in both index.html ("character-list-panel") and standalone character-lab.html ("character-list")
  const list = document.getElementById("character-list-panel") || document.getElementById("character-list");
  if (!list) return;

  try {
    const res = await levFetch(`${BASE}/characters`);
    const data = await res.json();
    const characters = data.characters || [];

    // PHASE 8F.4 — cache for edit lookups
    window.LEVRAM_CHARACTERS_CACHE = characters;

    // PHASE 8F.4 — flag case-insensitive name duplicates in console
    const nameCounts = {};
    characters.forEach(c => {
      const key = (c.name || "").toLowerCase().trim();
      nameCounts[key] = (nameCounts[key] || 0) + 1;
    });
    Object.entries(nameCounts).forEach(([key, count]) => {
    });

    if (!characters.length) {
      list.innerHTML = `<div class="character-empty">No saved characters yet.</div>`;
      return;
    }

    list.innerHTML = characters.map(c => `
      <div class="character-card${c.default_voice_profile ? " has-voice" : ""}">
        <div class="character-card-header">
          <span class="character-card-name">⚜ ${c.name || "Unnamed"}</span>
          ${c.default_voice_profile ? `<span class="character-card-voice-badge">Voice</span>` : ""}
        </div>
        <div class="character-card-meta">${[c.gender, c.age].filter(Boolean).join(" · ") || "No details"}</div>
        ${c.default_voice_profile ? `<div class="character-card-voice">⚡ ${c.default_voice_profile}</div>` : ""}
        <div class="character-card-actions">
          <button type="button" class="cl-btn-edit" onclick="loadCharacterIntoForm('${c.id || ""}')">Edit</button>
          <button type="button" class="cl-btn-delete" onclick="deleteCharacter('${c.id || ""}')">Delete</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("LOAD CHARACTERS ERROR:", err);
    list.innerHTML = `<div class="character-empty">Could not load saved characters.</div>`;
  }
}

// PHASE 8F.4 — load a saved character into the edit form
window.loadCharacterIntoForm = function loadCharacterIntoForm(id) {
  const cache = window.LEVRAM_CHARACTERS_CACHE || [];
  const c = cache.find(ch => ch.id === id);
  if (!c) {
    console.warn("PHASE 8F.4 loadCharacterIntoForm: id not found in cache:", id);
    return;
  }

  editingCharacterId = c.id;

  const fields = {
    "character-name": c.name || "",
    "character-gender": c.gender || "",
    "character-age": c.age || "",
    "character-appearance": c.appearance || "",
    "character-wardrobe": c.wardrobe || "",
    "character-voice": c.voice || "",
    "character-personality": c.personality || "",
    "character-notes": c.notes || ""
  };

  Object.entries(fields).forEach(([elId, value]) => {
    const el = document.getElementById(elId);
    if (el) el.value = value;
  });

  // Pre-select voice dropdown; safe fallback if profile no longer exists
  loadVoiceProfilesForCharacters(c.default_voice_profile || "");

  // Restore FX preset
  const fxPresetEl = document.getElementById("character-fx-preset");
  if (fxPresetEl) fxPresetEl.value = c.default_fx_preset || "clean";

  // Restore voice engine toggle
  setVoiceSource(c.voice_source || "edge_tts");
  const elVoiceId = document.getElementById("el-voice-id");
  if (elVoiceId) elVoiceId.value = c.elevenlabs_voice_id || "";
  const elStatus = document.getElementById("el-voice-status");
  if (elStatus) elStatus.textContent = c.elevenlabs_voice_id ? `Voice ID: ${c.elevenlabs_voice_id}` : "No voice cloned";
  if (c.rvc_model_path) {
    const sel = document.getElementById("rvc-model-select");
    if (sel) sel.value = c.rvc_model_path;
    const rvcStatus = document.getElementById("rvc-voice-status");
    if (rvcStatus) rvcStatus.textContent = `Model: ${c.rvc_model_path.split("/").pop()}`;
  }

  const saveBtn = document.getElementById("save-character-btn");
  if (saveBtn) saveBtn.textContent = "Update Character";

  const badge = document.getElementById("cl-edit-badge");
  if (badge) badge.style.display = "inline-block";

  // Load multi-image preview panel
  const prevImages  = c.preview_images || [];
  const activeIdx   = c.active_preview_index ?? 0;
  clRenderPreviewImages(prevImages, activeIdx);
  _clShowActivePreviewImg(prevImages, activeIdx);

  clRefreshLoraPanel(c);
};

// PHASE 8F.4 — delete a character by id
window.deleteCharacter = async function deleteCharacter(id) {
  if (!id) return;
  try {
    const res = await levFetch(`${BASE}/characters/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Delete failed");
    if (editingCharacterId === id) {
      editingCharacterId = null;
      const saveBtn = document.getElementById("save-character-btn");
      if (saveBtn) saveBtn.textContent = "Save Character";
    }
    await loadCharacters();
  } catch (err) {
    console.error("DELETE CHARACTER ERROR:", err);
  }
};

// PHASE 8F.4 — reset form to create a new character
window.newCharacter = function newCharacter() {
  editingCharacterId = null;
  clearCharacterForm();
  const badge = document.getElementById("cl-edit-badge");
  if (badge) badge.style.display = "none";
  const saveBtn = document.getElementById("save-character-btn");
  if (saveBtn) saveBtn.textContent = "Save Character";
};

// ── Reference Images + LoRA Training ──────────────────────────

window.clUploadPhotosGuarded = function() {
  if (!editingCharacterId) {
    const s = document.getElementById("cl-lora-status");
    if (s) { s.style.color = "#ff6b6b"; s.textContent = "Save the character first, then upload photos."; }
    return;
  }
  document.getElementById("cl-ref-upload")?.click();
};

async function clUploadReferences() {
  const input = document.getElementById("cl-ref-upload");
  const files = Array.from(input?.files || []);
  if (!files.length) return;

  if (!editingCharacterId) {
    levShowError("Save the character first, then upload reference images.");
    input.value = "";
    return;
  }

  const statusEl = document.getElementById("cl-lora-status");
  if (statusEl) statusEl.textContent = `Uploading ${files.length} image(s)…`;

  let uploadedCount = 0;
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await levFetch(`${BASE}/characters/${editingCharacterId}/upload-reference`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.success) uploadedCount++;
    } catch (err) {
      console.error("REF UPLOAD ERROR:", err);
    }
  }

  input.value = "";
  if (statusEl) statusEl.textContent = `Uploaded ${uploadedCount} of ${files.length}. Refreshing…`;
  await loadCharacters();
  const cached = (window.LEVRAM_CHARACTERS_CACHE || []).find(c => c.id === editingCharacterId);
  clRefreshLoraPanel(cached);
}

function clRefreshLoraPanel(character) {
  const refs = character?.reference_images || [];
  const thumbGrid = document.getElementById("cl-ref-thumbs");
  const countEl   = document.getElementById("cl-ref-count");
  const trainBtn  = document.getElementById("cl-train-btn");
  const statusEl  = document.getElementById("cl-lora-status");

  if (thumbGrid) {
    thumbGrid.innerHTML = refs.map((url, i) => {
      const src      = url.startsWith("http") ? url : BASE + url;
      const filename = url.split("/").pop();
      const isFirst  = i === 0;
      return `<div draggable="true" data-index="${i}" data-url="${url}"
                   style="position:relative;width:72px;height:72px;flex-shrink:0;cursor:grab;${isFirst ? 'outline:2px solid rgba(201,168,76,0.7);outline-offset:1px;border-radius:3px;' : ''}">
        <img src="${src}" style="width:72px;height:72px;object-fit:cover;border-radius:2px;border:1px solid rgba(201,168,76,0.2);display:block;pointer-events:none;" />
        ${isFirst ? `<div style="position:absolute;bottom:2px;left:2px;background:rgba(201,168,76,0.9);color:#000;font-size:8px;font-weight:bold;letter-spacing:1px;padding:1px 4px;border-radius:2px;pointer-events:none;">1ST</div>` : ''}
        <button onclick="clDeleteReference('${filename}')" title="Remove"
                style="position:absolute;top:2px;right:2px;width:20px;height:20px;background:rgba(160,10,10,0.92);border:1px solid rgba(255,80,80,0.6);border-radius:2px;color:#fff;font-size:13px;font-weight:bold;line-height:20px;text-align:center;cursor:pointer;padding:0;z-index:10;">×</button>
      </div>`;
    }).join("");
    thumbGrid.style.display  = "flex";
    thumbGrid.style.flexWrap = "wrap";
    thumbGrid.style.gap      = "4px";
    clWireDragToReorder(thumbGrid, character);
  }

  const count = refs.length;
  if (countEl) countEl.textContent = `${count} image${count !== 1 ? "s" : ""}`;

  if (trainBtn) {
    const ready = count >= 5;
    trainBtn.disabled = !ready;
    trainBtn.style.opacity = ready ? "1" : "0.5";
    trainBtn.textContent = ready
      ? (character?.lora_status === "ready" ? "Re-Train LoRA" : "Train LoRA")
      : `Train LoRA (need ${5 - count} more)`;
  }

  if (statusEl && character?.lora_status) {
    if (character.lora_status === "training") {
      statusEl.innerHTML = `Training in progress<span class="lora-dot">.</span><span class="lora-dot">.</span><span class="lora-dot">.</span>`;
      statusEl.style.color = "var(--text-dim)";
      clStartTrainingAnimation();
      clPollLoraStatus();
    } else if (character.lora_status === "ready") {
      statusEl.innerHTML = "LoRA READY ✔";
      statusEl.style.color = "var(--gold)";
      clStopTrainingAnimation();
    } else if (character.lora_status?.startsWith("failed")) {
      statusEl.innerHTML = "Training failed — try again";
      statusEl.style.color = "#ff6b6b";
      clStopTrainingAnimation();
    } else {
      statusEl.textContent = "";
      clStopTrainingAnimation();
    }
  }

  // Show reset button whenever there's a lora_status to clear
  const resetBtn = document.getElementById("cl-lora-reset-btn");
  if (resetBtn) {
    const hasStatus = character?.lora_status && character.lora_status !== "none" && character.lora_status !== "";
    resetBtn.style.display = hasStatus ? "inline-block" : "none";
  }
}

window.clResetLora = async function clResetLora() {
  if (!editingCharacterId) return;
  const statusEl = document.getElementById("cl-lora-status");
  const resetBtn = document.getElementById("cl-lora-reset-btn");
  if (resetBtn) resetBtn.disabled = true;
  try {
    const res  = await levFetch(`${BASE}/characters/${editingCharacterId}/reset-lora`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Reset failed");
    clStopTrainingAnimation();
    if (_loraStatusInterval) { clearInterval(_loraStatusInterval); _loraStatusInterval = null; }
    if (statusEl) { statusEl.textContent = "Status reset — ready to retrain."; statusEl.style.color = "var(--text-dim)"; }
    await loadCharacters();
    const cached = (window.LEVRAM_CHARACTERS_CACHE || []).find(c => c.id === editingCharacterId);
    clRefreshLoraPanel(cached);
  } catch (err) {
    if (statusEl) statusEl.textContent = `Reset failed: ${err.message}`;
    if (resetBtn) resetBtn.disabled = false;
  }
};

function clStartTrainingAnimation() {
  const trainBtn   = document.getElementById("cl-train-btn");
  const section    = document.getElementById("cl-lora-section");
  const progressEl = document.getElementById("cl-lora-progress");
  if (trainBtn)   { trainBtn.classList.add("lora-scanning"); }
  if (section)    { section.classList.add("lora-active"); }
  if (progressEl) { progressEl.classList.add("active"); }
}

function clStopTrainingAnimation() {
  const trainBtn   = document.getElementById("cl-train-btn");
  const section    = document.getElementById("cl-lora-section");
  const progressEl = document.getElementById("cl-lora-progress");
  if (trainBtn)   { trainBtn.classList.remove("lora-scanning"); }
  if (section)    { section.classList.remove("lora-active"); }
  if (progressEl) { progressEl.classList.remove("active"); }
}

async function clTrainLora() {
  if (!editingCharacterId) return;

  const trainBtn = document.getElementById("cl-train-btn");
  const statusEl = document.getElementById("cl-lora-status");

  if (trainBtn) { trainBtn.disabled = true; trainBtn.textContent = "Starting training…"; }
  if (statusEl) statusEl.textContent = "Submitting to fal.ai — training takes ~10 min…";
  clStartTrainingAnimation();

  try {
    const res = await levFetch(`${BASE}/characters/${editingCharacterId}/train-lora`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Training failed to start");

    if (statusEl) statusEl.innerHTML = `Training in progress<span class="lora-dot">.</span><span class="lora-dot">.</span><span class="lora-dot">.</span>`;
    clPollLoraStatus();
  } catch (err) {
    clStopTrainingAnimation();
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = "#ff6b6b"; }
    if (trainBtn) { trainBtn.disabled = false; trainBtn.textContent = "Retry Train LoRA"; }
    const resetBtn = document.getElementById("cl-lora-reset-btn");
    if (resetBtn) resetBtn.style.display = "inline-block";
  }
}

let _loraStatusInterval = null;
function clPollLoraStatus() {
  if (_loraStatusInterval) clearInterval(_loraStatusInterval);
  _loraStatusInterval = setInterval(async () => {
    if (!editingCharacterId) { clearInterval(_loraStatusInterval); return; }
    try {
      const res  = await levFetch(`${BASE}/characters/${editingCharacterId}/lora-status`);
      const data = await res.json();
      const statusEl = document.getElementById("cl-lora-status");
      if (data.lora_status === "ready") {
        clearInterval(_loraStatusInterval);
        clStopTrainingAnimation();
        if (statusEl) { statusEl.innerHTML = "LoRA READY ✔ — all future generations are character-locked"; statusEl.style.color = "var(--gold)"; }
        await loadCharacters();
        const cached = (window.LEVRAM_CHARACTERS_CACHE || []).find(c => c.id === editingCharacterId);
        clRefreshLoraPanel(cached);
      } else if (data.lora_status?.startsWith("failed")) {
        clearInterval(_loraStatusInterval);
        clStopTrainingAnimation();
        if (statusEl) { statusEl.innerHTML = "Training failed — check logs and retry"; statusEl.style.color = "#ff6b6b"; }
        const resetBtn = document.getElementById("cl-lora-reset-btn");
        if (resetBtn) resetBtn.style.display = "inline-block";
      } else {
        if (statusEl) statusEl.innerHTML = `Training in progress<span class="lora-dot">.</span><span class="lora-dot">.</span><span class="lora-dot">.</span> (${new Date().toLocaleTimeString()})`;
      }
    } catch (_) {}
  }, 30000);
}

function clWireDragToReorder(grid, character) {
  let dragSrcIndex = null;

  grid.querySelectorAll("[draggable]").forEach(el => {
    el.addEventListener("dragstart", e => {
      dragSrcIndex = parseInt(el.dataset.index);
      el.style.opacity = "0.4";
      e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragend", () => {
      el.style.opacity = "1";
      grid.querySelectorAll("[draggable]").forEach(t => t.classList.remove("drag-over"));
    });

    el.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      grid.querySelectorAll("[draggable]").forEach(t => t.classList.remove("drag-over"));
      el.style.outline = "2px solid rgba(201,168,76,0.9)";
    });

    el.addEventListener("dragleave", () => {
      const i = parseInt(el.dataset.index);
      el.style.outline = i === 0 ? "2px solid rgba(201,168,76,0.7)" : "";
    });

    el.addEventListener("drop", async e => {
      e.preventDefault();
      const dropIndex = parseInt(el.dataset.index);
      if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;

      const refs = [...(character?.reference_images || [])];
      const [moved] = refs.splice(dragSrcIndex, 1);
      refs.splice(dropIndex, 0, moved);

      // Optimistic UI update
      const cached = (window.LEVRAM_CHARACTERS_CACHE || []).find(c => c.id === editingCharacterId);
      if (cached) cached.reference_images = refs;
      clRefreshLoraPanel({ ...character, reference_images: refs });

      // Persist to DB
      try {
        const payload = { ...(cached || character), reference_images: refs };
        await levFetch(`${BASE}/characters/${editingCharacterId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("REORDER SAVE ERROR:", err);
      }
    });
  });
}

window.clDeleteReference = async function clDeleteReference(filename) {
  if (!editingCharacterId) return;
  try {
    const res  = await levFetch(`${BASE}/characters/${editingCharacterId}/reference/${filename}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Delete failed");
    await loadCharacters();
    const cached = (window.LEVRAM_CHARACTERS_CACHE || []).find(c => c.id === editingCharacterId);
    clRefreshLoraPanel(cached);
  } catch (err) {
    console.error("DELETE REFERENCE ERROR:", err);
  }
};

// ── Multi-image preview helpers ───────────────────────────────

function clRenderPreviewImages(images, activeIdx) {
  const grid = document.getElementById("cl-preview-images-grid");
  if (!grid) return;
  if (!images || images.length === 0) {
    grid.innerHTML = '<div style="font-size:11px;color:var(--text-dim);grid-column:1/-1;padding:4px 0;">No images yet — click + Add Image</div>';
    return;
  }
  grid.innerHTML = images.map((img, i) => {
    const displayUrl = img.url.startsWith("http") ? img.url : BASE + img.url;
    const isActive   = i === (activeIdx ?? 0);
    const labelEsc   = (img.label || "").replace(/"/g, "&quot;");
    return `<div style="position:relative;cursor:pointer;" onclick="clSetActivePreview(${i})">
      <img src="${displayUrl}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:3px;border:2px solid ${isActive ? "var(--gold)" : "rgba(255,255,255,0.1)"};" />
      ${isActive ? '<div style="position:absolute;top:2px;left:2px;background:var(--gold);color:#000;font-size:8px;font-weight:700;padding:1px 4px;border-radius:2px;letter-spacing:1px;line-height:14px;">ACTIVE</div>' : ""}
      <button onclick="event.stopPropagation();clRemovePreviewImage(${i})" style="position:absolute;top:2px;right:2px;background:rgba(140,20,20,0.9);border:none;color:#fff;width:16px;height:16px;border-radius:2px;cursor:pointer;font-size:10px;line-height:1;padding:0;">✕</button>
      <input type="text" value="${labelEsc}" placeholder="Label"
             onblur="clSavePreviewLabel(${i},this.value)" onclick="event.stopPropagation()"
             style="width:100%;box-sizing:border-box;margin-top:2px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.12);color:var(--text);font-size:10px;padding:2px 4px;border-radius:2px;" />
    </div>`;
  }).join("");
}

async function _clSavePreviewImages(previewImages, activeIdx) {
  const cache    = window.LEVRAM_CHARACTERS_CACHE || [];
  const existing = cache.find(c => c.id === editingCharacterId);
  if (!existing) return;
  const payload = { ...existing, preview_images: previewImages, active_preview_index: activeIdx };
  await levFetch(`${BASE}/characters/${editingCharacterId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  existing.preview_images         = previewImages;
  existing.active_preview_index   = activeIdx;
}

function _clShowActivePreviewImg(images, activeIdx) {
  const img      = document.getElementById("character-preview-img");
  const statusEl = document.getElementById("character-preview-status");
  if (!img) return;
  const entry = (images || [])[activeIdx ?? 0];
  if (entry) {
    const displayUrl = entry.url.startsWith("http") ? entry.url : BASE + entry.url;
    img.src = displayUrl;
    img.style.display = "block";
    if (statusEl) statusEl.textContent = `Active: ${entry.label || "Image " + ((activeIdx ?? 0) + 1)}`;
  } else {
    img.src = "";
    img.style.display = "none";
    if (statusEl) statusEl.textContent = "";
  }
}

window.clAddOwnPreview = async function clAddOwnPreview() {
  const input = document.getElementById("cl-own-preview-input");
  const file  = input?.files?.[0];
  if (!file) return;

  if (!editingCharacterId) {
    levShowError("Save the character first, then upload an image.");
    input.value = "";
    return;
  }

  const statusEl = document.getElementById("character-preview-status");
  if (statusEl) statusEl.textContent = "Uploading…";

  const fd = new FormData();
  fd.append("file", file);

  try {
    const res  = await levFetch(`${BASE}/video/upload-image`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Upload failed");

    const imageUrl = data.image_url;
    const cache    = window.LEVRAM_CHARACTERS_CACHE || [];
    const existing = cache.find(c => c.id === editingCharacterId);
    if (!existing) throw new Error("Character not found");

    const prevImages = [...(existing.preview_images || [])];
    const label      = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    prevImages.push({ url: imageUrl, label });

    const newActive = prevImages.length === 1 ? 0 : (existing.active_preview_index ?? 0);
    await _clSavePreviewImages(prevImages, newActive);

    clRenderPreviewImages(prevImages, newActive);
    _clShowActivePreviewImg(prevImages, newActive);
    if (statusEl) statusEl.textContent = `${prevImages.length} image${prevImages.length > 1 ? "s" : ""} — click one to set active ✔`;
  } catch (err) {
    if (statusEl) statusEl.textContent = "Upload failed: " + err.message;
    console.error("CL ADD PREVIEW ERROR:", err);
  }
  input.value = "";
};

window.clSetActivePreview = async function clSetActivePreview(idx) {
  if (!editingCharacterId) return;
  const cache    = window.LEVRAM_CHARACTERS_CACHE || [];
  const existing = cache.find(c => c.id === editingCharacterId);
  if (!existing) return;
  const prevImages = existing.preview_images || [];
  if (idx < 0 || idx >= prevImages.length) return;
  await _clSavePreviewImages(prevImages, idx);
  clRenderPreviewImages(prevImages, idx);
  _clShowActivePreviewImg(prevImages, idx);
};

window.clRemovePreviewImage = async function clRemovePreviewImage(idx) {
  if (!editingCharacterId) return;
  const cache    = window.LEVRAM_CHARACTERS_CACHE || [];
  const existing = cache.find(c => c.id === editingCharacterId);
  if (!existing) return;
  const prevImages = [...(existing.preview_images || [])];
  prevImages.splice(idx, 1);
  let activeIdx = existing.active_preview_index ?? 0;
  if (activeIdx >= prevImages.length) activeIdx = Math.max(0, prevImages.length - 1);
  await _clSavePreviewImages(prevImages, activeIdx);
  clRenderPreviewImages(prevImages, activeIdx);
  _clShowActivePreviewImg(prevImages, activeIdx);
};

window.clSavePreviewLabel = async function clSavePreviewLabel(idx, value) {
  if (!editingCharacterId) return;
  const cache    = window.LEVRAM_CHARACTERS_CACHE || [];
  const existing = cache.find(c => c.id === editingCharacterId);
  if (!existing) return;
  const prevImages = [...(existing.preview_images || [])];
  if (!prevImages[idx]) return;
  prevImages[idx] = { ...prevImages[idx], label: value };
  existing.preview_images = prevImages;
  await levFetch(`${BASE}/characters/${editingCharacterId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...existing, preview_images: prevImages }),
  });
};

window.clUploadReferences = clUploadReferences;
window.clTrainLora        = clTrainLora;

document.addEventListener("DOMContentLoaded", loadCharacters);
window.generateCharacterPreview = generateCharacterPreview;

function saveCharacterDraftLocal() {
  localStorage.setItem("levramCharacterDraft", JSON.stringify(getCharacterFormData()));
}

function loadCharacterDraftLocal() {
  try {
    const raw = localStorage.getItem("levramCharacterDraft");
    if (!raw) return;

    const d = JSON.parse(raw);

    const fields = {
      "character-name": d.name,
      "character-gender": d.gender,
      "character-age": d.age,
      "character-appearance": d.appearance,
      "character-wardrobe": d.wardrobe,
      "character-voice": d.voice,
      "character-default-voice": d.default_voice_profile,
      "character-personality": d.personality,
      "character-notes": d.notes
    };

    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el && value !== undefined) el.value = value;
    });
  } catch (err) {
    console.error("LOAD CHARACTER DRAFT ERROR:", err);
  }
}

function wireCharacterDraftPersistence() {
  loadCharacterDraftLocal();

  [
    "character-name",
    "character-gender",
    "character-age",
    "character-appearance",
    "character-wardrobe",
    "character-voice",
    "character-default-voice",
    "character-personality",
    "character-notes"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", saveCharacterDraftLocal);
  });
}

document.addEventListener("DOMContentLoaded", wireCharacterDraftPersistence);

window.clearCharacterForm = function clearCharacterForm() {

  [
    "character-name",
    "character-gender",
    "character-age",
    "character-appearance",
    "character-wardrobe",
    "character-voice",
    "character-default-voice",
    "character-personality",
    "character-notes"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  localStorage.removeItem("levramCharacterDraft");

  const promptBox = document.getElementById("character-preview-prompt");
  if (promptBox) promptBox.value = "";

  const img = document.getElementById("character-preview-img");
  if (img) {
    img.src = "";
    img.style.display = "none";
  }

  const status = document.getElementById("character-preview-status");
  if (status) status.textContent = "Form cleared.";

  console.log("Character form cleared.");
};


// PHASE 8F.4 — selectedValue pre-selects the dropdown; safe fallback if no longer exists
async function loadVoiceProfilesForCharacters(selectedValue = "") {
  const select = document.getElementById("character-default-voice");
  if (!select) return;

  try {
    const res = await levFetch(`${BASE}/voices`);
    const data = await res.json();
    const voices = data.voices || [];

    select.innerHTML = '<option value="">No Default Voice</option>';

    voices.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name || "";
      opt.textContent = v.name || "Unnamed Voice";
      select.appendChild(opt);
    });

    if (selectedValue) {
      const match = [...select.options].find(o => o.value === selectedValue);
      if (match) {
        select.value = selectedValue;
      } else {
        // Profile saved on character no longer exists in /voices — safe fallback
        console.warn("PHASE 8F.4 VOICE PROFILE NOT FOUND IN LIBRARY:", selectedValue, "— defaulting to empty");
        select.value = "";
      }
    }
  } catch (err) {
    console.error("CHARACTER VOICE PROFILE LOAD ERROR:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadVoiceProfilesForCharacters);

// ═══════════════════════════════════════════════════════════════
// VOICE ENGINE — Toggle, ElevenLabs clone, RVC model upload
// ═══════════════════════════════════════════════════════════════

function setVoiceSource(source) {
  document.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.source === source);
  });
  document.querySelectorAll(".cl-voice-panel").forEach(panel => {
    panel.style.display = "none";
  });
  const active = document.getElementById(`voice-panel-${source}`);
  if (active) active.style.display = "flex";
}

document.addEventListener("DOMContentLoaded", () => {
  // Voice source toggle
  document.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.addEventListener("click", () => setVoiceSource(btn.dataset.source));
  });

  // RVC sub-toggle (Pre-trained / My Voice)
  document.querySelectorAll(".cl-rvc-sub").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cl-rvc-sub").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const hint = document.getElementById("rvc-hint");
      if (hint) {
        hint.textContent = btn.dataset.rvcType === "my_voice"
          ? "Upload a .pth model trained on your own voice recordings."
          : "Upload a community .pth model for a character voice type.";
      }
    });
  });

  // Init panels
  setVoiceSource("edge_tts");
  loadRvcModels();
});

// ── ElevenLabs: upload sample → clone voice ────────────────────
window.cloneElevenLabsVoice = async function cloneElevenLabsVoice() {
  const fileInput = document.getElementById("el-sample-file");
  const status = document.getElementById("el-voice-status");
  const voiceIdInput = document.getElementById("el-voice-id");
  const charName = document.getElementById("character-name")?.value.trim() || "LEVRAM Character";

  if (!fileInput?.files?.length) {
    if (status) status.textContent = "Select an audio file first.";
    return;
  }

  if (status) status.textContent = "Cloning voice with ElevenLabs...";

  const fd = new FormData();
  fd.append("character_name", charName);
  fd.append("file", fileInput.files[0]);

  try {
    const res = await levFetch(`${BASE}/voice-clone/elevenlabs`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Clone failed");

    if (voiceIdInput) voiceIdInput.value = data.voice_id;
    if (status) status.textContent = `Cloned ✔ Voice ID: ${data.voice_id}`;
  } catch (err) {
    console.error("EL CLONE ERROR:", err);
    if (status) status.textContent = `Clone failed: ${err.message}`;
  }
};

// ── RVC: upload .pth model ──────────────────────────────────────
window.uploadRvcModel = async function uploadRvcModel() {
  const modelFile = document.getElementById("rvc-model-file");
  const indexFile = document.getElementById("rvc-index-file");
  const status = document.getElementById("rvc-voice-status");
  const charName = document.getElementById("character-name")?.value.trim() || "rvc_model";

  if (!modelFile?.files?.length) {
    if (status) status.textContent = "Select a .pth file first.";
    return;
  }

  if (status) status.textContent = "Uploading model...";

  const fd = new FormData();
  fd.append("model_name", charName);
  fd.append("model_file", modelFile.files[0]);
  if (indexFile?.files?.length) fd.append("index_file", indexFile.files[0]);

  try {
    const res = await levFetch(`${BASE}/voice-clone/rvc/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Upload failed");

    if (status) status.textContent = `Model uploaded ✔ ${data.model_name}`;
    await loadRvcModels(data.model_path);
  } catch (err) {
    console.error("RVC UPLOAD ERROR:", err);
    if (status) status.textContent = `Upload failed: ${err.message}`;
  }
};

async function loadRvcModels(selectPath = null) {
  const sel = document.getElementById("rvc-model-select");
  if (!sel) return;

  try {
    const res = await levFetch(`${BASE}/voice-clone/rvc/models`);
    const data = await res.json();
    const models = data.models || [];

    sel.innerHTML = '<option value="">Select loaded model...</option>';
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.model_path;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });

    if (selectPath) sel.value = selectPath;
  } catch (err) {
    console.error("LOAD RVC MODELS ERROR:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// VOICE PICKER MODAL
// ═══════════════════════════════════════════════════════════════

let _vpAllVoices = [];

window.openVoicePicker = async function openVoicePicker() {
  const modal = document.getElementById("voice-picker-modal");
  const grid  = document.getElementById("vp-grid");
  if (!modal) return;

  modal.style.display = "flex";
  grid.innerHTML = '<div class="vp-loading">Loading voices...</div>';

  try {
    const res  = await levFetch(`${BASE}/voice-clone/elevenlabs/voices`);
    const data = await res.json();
    _vpAllVoices = data.voices || [];
    renderVoiceCards(_vpAllVoices);
  } catch (err) {
    grid.innerHTML = `<div class="vp-loading">Could not load voices — is backend running?</div>`;
    console.error("VOICE PICKER LOAD ERROR:", err);
  }
};

window.closeVoicePicker = function closeVoicePicker(e) {
  // Close if clicking the backdrop, or the close button (no event = button click)
  if (!e || e.target.id === "voice-picker-modal") {
    document.getElementById("voice-picker-modal").style.display = "none";
  }
};

window.filterVoices = function filterVoices(query) {
  const q = query.toLowerCase();
  const filtered = _vpAllVoices.filter(v =>
    v.name.toLowerCase().includes(q)
  );
  renderVoiceCards(filtered);
};

function renderVoiceCards(voices) {
  const grid = document.getElementById("vp-grid");
  if (!voices.length) {
    grid.innerHTML = '<div class="vp-loading">No voices match.</div>';
    return;
  }

  grid.innerHTML = voices.map(v => {
    const dashIdx = v.name.indexOf(" - ");
    const displayName = dashIdx > -1 ? v.name.slice(0, dashIdx) : v.name;
    const description = dashIdx > -1 ? v.name.slice(dashIdx + 3) : "";

    const lower = v.name.toLowerCase();
    let tag = v.category === "cloned" ? "YOUR CLONE" : "PREMADE";
    if (/dominant|fierce|warrior|firm/.test(lower)) tag = "VILLAIN";
    else if (/deep|resonant|comforting|wise|mature/.test(lower)) tag = "DEEP";
    else if (/storyteller|captivating|broadcaster/.test(lower)) tag = "NARRATOR";
    else if (/husky|trickster|callum/.test(lower)) tag = "OMINOUS";

    const safeId   = v.voice_id;
    const safeName = displayName.replace(/'/g, "\\'");
    const previewUrl = v.preview_url || "";

    return `
      <div class="vp-card">
        <div class="vp-card-name">${displayName}</div>
        ${description ? `<div class="vp-card-desc">${description}</div>` : ""}
        <span class="vp-card-tag">${tag}</span>
        <div class="vp-card-btns">
          ${previewUrl
            ? `<button class="vp-card-play" onclick="previewVoiceClip(event,'${previewUrl}')">▶ Preview</button>`
            : `<button class="vp-card-play" onclick="testVoiceGenerate(event,'${safeId}')">▶ Test</button>`
          }
          <button class="vp-card-select" onclick="selectElevenLabsVoice('${safeId}','${safeName}')">Select</button>
        </div>
      </div>`;
  }).join("");
}

// Play the free ElevenLabs preview clip (no credits used)
let _activePreviewAudio = null;
window.previewVoiceClip = function previewVoiceClip(e, url) {
  e.stopPropagation();
  if (_activePreviewAudio) { _activePreviewAudio.pause(); _activePreviewAudio = null; }
  _activePreviewAudio = new Audio(url);
  _activePreviewAudio.play();
  const btn = e.currentTarget;
  btn.textContent = "◼ Stop";
  _activePreviewAudio.onended = () => { btn.textContent = "▶ Preview"; };
  btn.onclick = (ev) => {
    ev.stopPropagation();
    _activePreviewAudio.pause();
    _activePreviewAudio = null;
    btn.textContent = "▶ Preview";
    btn.onclick = (ev2) => previewVoiceClip(ev2, url);
  };
};

// Generate a sample line via TTS (uses credits — fallback when no preview_url)
window.testVoiceGenerate = async function testVoiceGenerate(e, voiceId) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const testText = document.getElementById("vp-test-text")?.value.trim()
    || "The shadows bow before me. I am inevitable.";
  btn.textContent = "...";
  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("voice_id", voiceId);
    fd.append("text", testText);
    const res  = await levFetch(`${BASE}/voice-clone/elevenlabs/test`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.audio_url) {
      if (_activePreviewAudio) _activePreviewAudio.pause();
      _activePreviewAudio = new Audio(`${BASE}${data.audio_url}`);
      _activePreviewAudio.play();
    }
  } catch (err) { console.error("TEST VOICE ERROR:", err); }
  btn.textContent = "▶ Test";
  btn.disabled = false;
};

// Test the voice currently saved in the EL panel
window.testSelectedVoice = async function testSelectedVoice() {
  const voiceId = document.getElementById("el-voice-id")?.value.trim();
  const text    = document.getElementById("el-test-line")?.value.trim()
    || "The shadows bow before me. I am inevitable.";
  const audio   = document.getElementById("el-test-audio");
  const status  = document.getElementById("el-voice-status");

  if (!voiceId) { if (status) status.textContent = "Select a voice first."; return; }
  if (status) status.textContent = "Generating...";

  const fd = new FormData();
  fd.append("voice_id", voiceId);
  fd.append("text", text);

  try {
    const res  = await levFetch(`${BASE}/voice-clone/elevenlabs/test`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.audio_url && audio) {
      audio.src = `${BASE}${data.audio_url}`;
      audio.style.display = "block";
      audio.play();
      if (status) status.textContent = "▶ Playing — adjust FX in Voice Lab after selecting";
    }
  } catch (err) {
    if (status) status.textContent = "Test failed — check backend";
    console.error("TEST SELECTED VOICE ERROR:", err);
  }
};

window.selectElevenLabsVoice = function selectElevenLabsVoice(voiceId, name) {
  const idInput  = document.getElementById("el-voice-id");
  const status   = document.getElementById("el-voice-status");

  if (idInput) idInput.value = voiceId;
  if (status)  status.textContent = `✔ ${name} selected`;

  document.getElementById("voice-picker-modal").style.display = "none";

  // Clear search for next open
  const search = document.getElementById("vp-search");
  if (search) search.value = "";
};

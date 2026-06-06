const BASE = "http://127.0.0.1:8000";

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
  };
}

function buildCharacterImagePrompt(character) {
  return [
    "cinematic character portrait",
    character.name ? `character named ${character.name}` : "",
    character.gender,
    character.age,
    character.appearance,
    character.wardrobe,
    character.personality ? `personality: ${character.personality}` : "",
    character.notes,
    "high detail, realistic, dramatic lighting, film still, sharp focus, consistent face, full character design reference"
  ].filter(Boolean).join(", ");
}

async function generateCharacterPreview() {
  const status = document.getElementById("character-preview-status");
  const promptBox = document.getElementById("character-preview-prompt");
  const img = document.getElementById("character-preview-img");

  const character = getCharacterFormData();
  const prompt = buildCharacterImagePrompt(character);

  if (promptBox) promptBox.value = prompt;
  // PHASE 8G — timing expectation: ComfyUI takes 30–120s
  if (status) status.textContent = "GENERATING — this may take 30–120 seconds...";
  if (img) img.style.display = "none";

  try {
    const res = await fetch(`${BASE}/character-lab/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, prompt })
    });

    const data = await res.json();
    console.log("CHARACTER PREVIEW RESPONSE:", data);

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
      if (status) status.textContent = "NO IMAGE URL RETURNED — CHECK BACKEND RESPONSE";
      return;
    }

    const finalUrl = imageUrl.startsWith("http") ? imageUrl : `${BASE}${imageUrl}`;

    if (!img) {
      if (status) status.textContent = `IMAGE GENERATED: ${finalUrl}`;
      return;
    }

    img.onerror = () => {
      if (status) status.textContent = `IMAGE URL RETURNED BUT FILE NOT SERVED: ${finalUrl}`;
    };

    img.onload = () => {
      if (status) status.textContent = "CHARACTER PREVIEW LOADED ✔";
    };

    img.src = finalUrl;
    img.style.display = "block";

    // PHASE 8G — persist reference image URL to the character record if one is being edited
    if (editingCharacterId) {
      try {
        const cache = window.LEVRAM_CHARACTERS_CACHE || [];
        const existing = cache.find(c => c.id === editingCharacterId);
        if (existing) {
          const payload = { ...existing, reference_image_url: finalUrl };
          await fetch(`${BASE}/characters/${editingCharacterId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          await loadCharacters();
          console.log("PHASE 8G REFERENCE IMAGE SAVED:", finalUrl);
        }
      } catch (saveErr) {
        console.warn("PHASE 8G could not save reference image to character:", saveErr);
      }
    }
  } catch (err) {
    console.error("CHARACTER PREVIEW ERROR:", err);
    if (status) status.textContent = "FRONTEND ERROR — CHECK CONSOLE";
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
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(character)
    });

    const data = await res.json();
    console.log("SAVE CHARACTER RESPONSE:", data);

    if (!res.ok) {
      if (saveBtn) saveBtn.textContent = "SAVE FAILED";
      if (status) {
        status.style.display = "block";
        status.textContent = "SAVE FAILED — BACKEND REJECTED";
      }
      return;
    }

    // PHASE 8F.4 — reset edit state after successful save
    editingCharacterId = null;
    const badge = document.getElementById("cl-edit-badge");
    if (badge) badge.style.display = "none";

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
    const res = await fetch(`${BASE}/characters`);
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
      if (count > 1) console.warn(`PHASE 8F.4 DUPLICATE CHARACTER NAME: "${key}" appears ${count} times`);
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

  // PHASE 8G — auto-load existing reference image into the preview panel
  const previewImg = document.getElementById("character-preview-img");
  const previewStatus = document.getElementById("character-preview-status");
  if (previewImg) {
    if (c.reference_image_url) {
      previewImg.src = c.reference_image_url;
      previewImg.style.display = "block";
      if (previewStatus) previewStatus.textContent = "Reference image loaded ✔";
    } else {
      previewImg.src = "";
      previewImg.style.display = "none";
      if (previewStatus) previewStatus.textContent = "";
    }
  }

  console.log("PHASE 8F.4 EDITING CHARACTER:", c.name, "id:", c.id);
};

// PHASE 8F.4 — delete a character by id
window.deleteCharacter = async function deleteCharacter(id) {
  if (!id) return;
  try {
    const res = await fetch(`${BASE}/characters/${id}`, { method: "DELETE" });
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
    const res = await fetch(`${BASE}/voices`);
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
    const res = await fetch(`${BASE}/voice-clone/elevenlabs`, { method: "POST", body: fd });
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
    const res = await fetch(`${BASE}/voice-clone/rvc/upload`, { method: "POST", body: fd });
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
    const res = await fetch(`${BASE}/voice-clone/rvc/models`);
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
    const res  = await fetch(`${BASE}/voice-clone/elevenlabs/voices`);
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
    const res  = await fetch(`${BASE}/voice-clone/elevenlabs/test`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.audio_url) {
      if (_activePreviewAudio) _activePreviewAudio.pause();
      _activePreviewAudio = new Audio(`http://localhost:8000${data.audio_url}`);
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
    const res  = await fetch(`${BASE}/voice-clone/elevenlabs/test`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.audio_url && audio) {
      audio.src = `http://localhost:8000${data.audio_url}`;
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

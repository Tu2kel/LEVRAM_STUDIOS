const BASE = "http://127.0.0.1:8000";

// PHASE 8F.4 — track which character is being edited (null = new)
let editingCharacterId = null;

function getCharacterFormData() {
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

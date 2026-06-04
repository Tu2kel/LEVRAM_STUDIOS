const BASE = "http://127.0.0.1:8000";

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
  if (status) status.textContent = "GENERATING CHARACTER VISUAL TEST...";
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
  } catch (err) {
    console.error("CHARACTER PREVIEW ERROR:", err);
    if (status) status.textContent = "FRONTEND ERROR — CHECK CONSOLE";
  }
}

window.saveCharacter = async function saveCharacter() {
  const character = getCharacterFormData();
  const status = document.getElementById("character-lab-status");
  const saveBtn = document.getElementById("save-character-btn");

  if (saveBtn) saveBtn.textContent = "SENDING...";

  try {
    const res = await fetch(`${BASE}/characters`, {
      method: "POST",
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
  const list = document.getElementById("character-list");
  if (!list) return;

  try {
    const res = await fetch(`${BASE}/characters`);
    const data = await res.json();
    const characters = data.characters || [];

    if (!characters.length) {
      list.innerHTML = `<div class="character-empty">No saved characters yet.</div>`;
      return;
    }

    list.innerHTML = characters.map(c => `
      <div class="character-card">
        <div class="character-card-name">⚜ ${c.name || "Unnamed Character"}</div>
        <div class="character-card-meta">${c.gender || "Unknown"} • ${c.age || "Age N/A"}</div>
        <div class="character-card-text">${c.appearance || ""}</div>
        <div class="character-card-text">${c.wardrobe || ""}</div>
      </div>
    `).join("");
  } catch (err) {
    console.error("LOAD CHARACTERS ERROR:", err);
    list.innerHTML = `<div class="character-empty">Could not load saved characters.</div>`;
  }
}

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


async function loadVoiceProfilesForCharacters() {
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
  } catch (err) {
    console.error("CHARACTER VOICE PROFILE LOAD ERROR:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadVoiceProfilesForCharacters);

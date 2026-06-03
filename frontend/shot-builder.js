function loadSceneIntoEditor(scene) {
        selectedSceneId = scene.id;

        document.getElementById("shot-project").value = scene.project || "";
        document.getElementById("shot-scene").value = scene.sceneNum
          ? `SC-${scene.sceneNum}`
          : scene.id || "";
        document.getElementById("shot-desc").value = scene.shotDesc || "";
        document.getElementById("shot-prompt-input").value =
          scene.shotPrompt || "";
        document.getElementById("script-input").value = scene.dialogue || "";

        if (scene.duration) {
          document.getElementById("shot-duration").value = scene.duration;
        }

        rawUrl = scene.rawUrl || null;
        fxUrl = scene.fxUrl || null;

        setActiveSceneForBattery(scene);

        setStatus(`Loaded ${scene.id} for editing.`);
      }

// ─── Build / Save Shot Card ───────────────────────────────
      document
        .getElementById("btn-save-shot")
        .addEventListener("click", async () => {
          try {
            const primaryCharacter =
              document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "";

            const secondaryCharacter =
              document.getElementById("shot-character-secondary")?.selectedOptions?.[0]?.textContent || "";
            const dialogue = document
              .getElementById("script-input")
              .value.trim();

            const payload = {
              project: document.getElementById("shot-project").value,
              scene_number: (() => {
                const raw = document.getElementById("shot-scene").value.trim();
                if (!raw) return "";
                return raw.toUpperCase().startsWith("SC-") ? raw.toUpperCase() : `SC-${raw}`;
              })(),
              shot_type: document.getElementById("shot-type").value,
              camera_mood: document.getElementById("shot-camera").value,
              color_palette: document.getElementById("shot-palette").value,
              ai_engine: document.getElementById("shot-engine").value,
              shot_description: document
                .getElementById("shot-desc")
                .value.trim(),
              shot_prompt: document
                .getElementById("shot-prompt-input")
                .value.trim(),
              negative_prompt:
                "blurry, low quality, watermark, text, bad anatomy, extra fingers, duplicate limbs, cropped, distorted face, deformed hands",
              character: primaryCharacter,
              secondary_character: secondaryCharacter,
              duration: document.getElementById("shot-duration").value,
              voice_character: getActiveCharacter(),
              voice_preset: getActiveFxPreset(),
              dialogue: dialogue,
              rawUrl: rawUrl,
              fxUrl: fxUrl,
            };

            const saveUrl = selectedSceneId
              ? `http://localhost:8000/scene/${selectedSceneId}`
              : "http://localhost:8000/save-scene";

            const saveMethod = selectedSceneId ? "PUT" : "POST";

            const res = await fetch(saveUrl, {
              method: saveMethod,
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!data.success) {
              throw new Error("Failed to save scene");
            }

            await loadScenes();

            selectedSceneId = data.scene.id;

            setStatus(
              saveMethod === "PUT"
                ? `Scene ${data.scene.id} updated.`
                : `Scene ${data.scene.id} saved.`,
            );
          } catch (e) {
            console.error(e);
            setStatus("Failed to save scene", true);
          }
        });

// ─── Phase 7: Prompt Intelligence ─────────────────────────
function buildCinematicPrompt() {
  const character =
    document.getElementById("shot-char-override")?.value.trim() ||
    getActiveCharacter() ||
    "main character";

  const shotType = document.getElementById("shot-type")?.value || "";
  const cameraMood = document.getElementById("shot-camera")?.value || "";
  const palette = document.getElementById("shot-palette")?.value || "";
  const description = document.getElementById("shot-desc")?.value.trim() || "";

  const prompt = [
    description.toLowerCase().includes(character.toLowerCase())
      ? description
      : `${character}, ${description}`,
    `${shotType}`,
    `${cameraMood}`,
    `${palette}`,
    "cinematic composition",
    "dramatic lighting",
    "high detail",
    "sharp focus",
    "depth of field",
    "film still",
    "photorealistic"
  ]
    .filter(Boolean)
    .join(", ");

  document.getElementById("shot-prompt-input").value = prompt;

  setStatus("Cinematic prompt generated.");
  return prompt;
}

document
  .getElementById("btn-generate-prompt")
  ?.addEventListener("click", buildCinematicPrompt);

// ─── AI Shot Assistant ─────────────────────────────────────
document
  .getElementById("btn-ai-build-shot")
  ?.addEventListener("click", async () => {
    try {
      const idea =
        document.getElementById("ai-shot-idea")?.value.trim();

      if (!idea) {
        setStatus("Enter an AI Shot Idea first.", true);
        return;
      }

      const res = await fetch(
        "http://127.0.0.1:8000/ai/build-shot",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            idea,
            visual_character:
              document.getElementById("shot-char-override")?.value.trim() || "",
            voice_character:
              typeof getActiveCharacter === "function"
                ? getActiveCharacter()
                : "",
            character:
              document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "",
            secondary_character:
              document.getElementById("shot-character-secondary")?.selectedOptions?.[0]?.textContent || "",
            shot_type:
              document.getElementById("shot-type")?.value || "",
            camera_mood:
              document.getElementById("shot-camera")?.value || "",
            color_palette:
              document.getElementById("shot-palette")?.value || ""
          })
        }
      );

      const data = await res.json();

      console.log("AI BUILD RESPONSE:", data);

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "AI build failed");
      }

      const ai = data.data || data.shot || data.result || {};

      document.getElementById("shot-desc").value =
        ai.shot_description || ai.description || "";

      document.getElementById("shot-prompt-input").value =
        ai.shot_prompt || ai.prompt || "";

      const shotTypeAi = document.getElementById("shot-type-ai");
      const shotCameraAi = document.getElementById("shot-camera-ai");
      const shotPaletteAi = document.getElementById("shot-palette-ai");

      if (shotTypeAi) shotTypeAi.textContent =
        "AI: " + (ai.suggested_shot_type || "Unknown");

      if (shotCameraAi) shotCameraAi.textContent =
        "AI: " + (ai.suggested_camera_mood || "Unknown");

      if (shotPaletteAi) shotPaletteAi.textContent =
        "AI: " + (ai.suggested_color_palette || "Unknown");

      setSelectIfOptionExists(
        "shot-type",
        ai.suggested_shot_type
      );

      setSelectIfOptionExists(
        "shot-camera",
        ai.suggested_camera_mood
      );

      setSelectIfOptionExists(
        "shot-palette",
        ai.suggested_color_palette
      );

      setStatus("AI shot generated.");
    } catch (err) {
      console.error("AI BUILD ERROR:", err);
      setStatus(err.message || "AI shot generation failed.", true);
    }
  });

// ─── Helper: Select dropdown value if AI returns matching option ─────────
function setSelectIfOptionExists(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select || !value) return;

  const match = [...select.options].find(
    (opt) => opt.value.toLowerCase() === value.toLowerCase()
  );

  if (match) select.value = match.value;
}

// ─── AI Revise Shot ────────────────────────────────────────
document
  .getElementById("btn-ai-revise-shot")
  ?.addEventListener("click", async () => {

    const override =
      document.getElementById("ai-override-notes")?.value.trim();

    if (!override) {
      setStatus("Enter Override Instructions first.", true);
      return;
    }

    const res = await fetch(
      "http://127.0.0.1:8000/ai/revise-shot",
      {
        method: "POST",
        headers: {
          "Content-Type":"application/json"
        },
        body: JSON.stringify({
          current_description:
            document.getElementById("shot-desc").value,
          current_prompt:
            document.getElementById("shot-prompt-input").value,
          override_notes: override,
          character:
            document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "",
          secondary_character:
            document.getElementById("shot-character-secondary")?.selectedOptions?.[0]?.textContent || ""
        })
      }
    );

    const data = await res.json();

    document.getElementById("shot-desc").value =
      data.data.shot_description || "";

    document.getElementById("shot-prompt-input").value =
      data.data.shot_prompt || "";

    setSelectIfOptionExists(
      "shot-type",
      data.data.suggested_shot_type
    );

    setSelectIfOptionExists(
      "shot-camera",
      data.data.suggested_camera_mood
    );

    setSelectIfOptionExists(
      "shot-palette",
      data.data.suggested_color_palette
    );

    setStatus("Shot revised from Director Notes.");
  });

// ─── Override Mode Toggles ────────────────────────────────
[
  ["shot-type-mode","shot-type-override-wrap"],
  ["shot-camera-mode","shot-camera-override-wrap"],
  ["shot-palette-mode","shot-palette-override-wrap"]
].forEach(([modeId, wrapId]) => {

  const mode = document.getElementById(modeId);
  const wrap = document.getElementById(wrapId);

  if (!mode || !wrap) return;

  mode.addEventListener("change", () => {
    wrap.style.display =
      mode.value === "Manual Override"
        ? "block"
        : "none";
  });
});

// Manual Override fields
function wireManualOverride(selectId, textareaId, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  let textarea = document.getElementById(textareaId);

  if (!textarea) {
    textarea = document.createElement("textarea");
    textarea.id = textareaId;
    textarea.placeholder = placeholder;
    textarea.className = "manual-override-textarea";
    textarea.style.display = "none";
    select.parentElement.appendChild(textarea);
  }

  select.addEventListener("change", () => {
    textarea.style.display = select.value === "Manual Override" ? "block" : "none";
  });
}

wireManualOverride("shot-type", "shot-type-override", "Enter manual shot type...");
wireManualOverride("camera-mood", "camera-mood-override", "Enter manual camera mood...");
wireManualOverride("color-palette", "color-palette-override", "Enter manual color palette...");

// Manual Override fields for Shot Builder dropdowns
function wireManualOverride(selectId, textareaId, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  let textarea = document.getElementById(textareaId);

  if (!textarea) {
    textarea = document.createElement("textarea");
    textarea.id = textareaId;
    textarea.placeholder = placeholder;
    textarea.className = "manual-override-textarea";
    textarea.style.display = "none";
    select.parentElement.appendChild(textarea);
  }

  select.addEventListener("change", () => {
    textarea.style.display = select.value === "Manual Override" ? "block" : "none";
  });
}

wireManualOverride("shot-type", "shot-type-override", "Enter manual shot type...");
wireManualOverride("shot-camera", "shot-camera-override", "Enter manual camera mood...");
wireManualOverride("shot-palette", "shot-palette-override", "Enter manual color palette...");


// ===============================
// PHASE 8C — CHARACTER PICKER
// ===============================

window.LEVRAM_CHARACTERS = window.LEVRAM_CHARACTERS || [];
window.LEVRAM_SELECTED_CHARACTER_PROMPT = "";

function levramCharacterText(c) {
  if (!c) return "";

  const parts = [];

  const name = c.name || c.character_name || c.title;
  if (name) parts.push(String(name));

  [
    "description",
    "appearance",
    "physical_description",
    "body",
    "face",
    "hair",
    "costume",
    "suit",
    "clothing",
    "powers",
    "traits",
    "personality",
    "visual_prompt",
    "prompt",
    "character_prompt"
  ].forEach((key) => {
    if (typeof c[key] === "string" && c[key].trim()) {
      parts.push(c[key].trim());
    }
  });

  return parts.join(", ").replace(/\s+/g, " ").trim();
}

async function loadLevramCharacters() {
  const select = document.getElementById("shot-character");
  const secondarySelect = document.getElementById("shot-character-secondary");
  if (!select) return;

  try {
    const res = await fetch("http://127.0.0.1:8000/characters");
    const data = await res.json();

    const characters = Array.isArray(data)
      ? data
      : Array.isArray(data.characters)
        ? data.characters
        : [];

    window.LEVRAM_CHARACTERS = characters;
    select.innerHTML = '<option value="">None</option>';
    if (secondarySelect) {
      secondarySelect.innerHTML = '<option value="">None</option>';
    }

    characters.forEach((char, index) => {
      const name = char.name || char.character_name || char.title || `Character ${index + 1}`;
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = name;
      select.appendChild(opt);

      if (secondarySelect) {
        const opt2 = document.createElement("option");
        opt2.value = String(index);
        opt2.textContent = name;
        secondarySelect.appendChild(opt2);
      }
    });

    function updateSelectedCharacterPrompts() {
      const primary = characters[Number(select.value)];
      const secondary = secondarySelect
        ? characters[Number(secondarySelect.value)]
        : null;

      const primaryPrompt = primary ? levramCharacterText(primary) : "";
      const secondaryPrompt = secondary ? levramCharacterText(secondary) : "";

      window.LEVRAM_SELECTED_CHARACTER_PROMPT =
        [primaryPrompt, secondaryPrompt].filter(Boolean).join("\n\nSECONDARY CHARACTER:\n");

      console.log("PHASE 8D PRIMARY CHARACTER:", primary || "None");
      console.log("PHASE 8D SECONDARY CHARACTER:", secondary || "None");
      console.log("PHASE 8D CHARACTER PROMPT:", window.LEVRAM_SELECTED_CHARACTER_PROMPT);
    }

    select.addEventListener("change", updateSelectedCharacterPrompts);

    if (secondarySelect) {
      secondarySelect.addEventListener("change", updateSelectedCharacterPrompts);
    }

    console.log("PHASE 8C CHARACTERS LOADED:", characters.length);
  } catch (err) {
    console.error("PHASE 8C CHARACTER LOAD FAILED:", err);
  }
}

function levramInjectCharacterIntoText(text) {
  const charPrompt = window.LEVRAM_SELECTED_CHARACTER_PROMPT;

  if (!charPrompt || typeof text !== "string" || !text.trim()) return text;
  if (text.includes(charPrompt)) return text;

  return `${charPrompt},\n\n${text}`;
}

function levramInjectCharacterIntoPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (!window.LEVRAM_SELECTED_CHARACTER_PROMPT) return payload;

  [
    "prompt",
    "shot_prompt",
    "current_prompt",
    "description",
    "shot_description",
    "current_description"
  ].forEach((key) => {
    if (typeof payload[key] === "string") {
      payload[key] = levramInjectCharacterIntoText(payload[key]);
    }
  });

  payload.character_context = window.LEVRAM_SELECTED_CHARACTER_PROMPT;
  return payload;
}

document.addEventListener("DOMContentLoaded", loadLevramCharacters);

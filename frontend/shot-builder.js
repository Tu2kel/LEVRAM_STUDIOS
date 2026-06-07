const SB_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

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
              ai_engine: document.getElementById("shot-engine")?.value || "",
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
              ? `${SB_BASE}/scene/${selectedSceneId}`
              : `${SB_BASE}/save-scene`;

            const saveMethod = selectedSceneId ? "PUT" : "POST";

            const res = await levFetch(saveUrl, {
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

// ─── Phase 8H: Character Panel ────────────────────────────
function renderCharacterPanel(character) {
  const panel = document.getElementById("shot-character-panel");
  if (!panel) return;

  if (!character) {
    panel.style.display = "none";
    panel.innerHTML = "";
    return;
  }

  const name = character.name || "Unknown";
  const appearance = character.appearance || "";
  const wardrobe = character.wardrobe || "";
  const voice = character.default_voice_profile || "";
  const rawImgUrl = character.reference_image_url || "";
  const imgUrl = rawImgUrl.startsWith("http") ? rawImgUrl : (rawImgUrl ? SB_BASE + rawImgUrl : "");

  panel.style.display = "block";
  panel.innerHTML = `
    <div style="
      display:flex;gap:12px;align-items:flex-start;
      padding:10px 12px;
      background:rgba(201,168,76,0.05);
      border:1px solid rgba(201,168,76,0.2);
      border-left:3px solid var(--gold);
      border-radius:6px;
      margin-bottom:2px;
    ">
      ${imgUrl ? `<img src="${imgUrl}" style="width:64px;height:80px;object-fit:cover;border-radius:4px;border:1px solid rgba(201,168,76,0.3);flex-shrink:0;" />` : ""}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--gold);letter-spacing:1px;margin-bottom:4px;">⚜ ${name}</div>
        ${appearance ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${appearance.slice(0, 100)}${appearance.length > 100 ? "…" : ""}</div>` : ""}
        ${wardrobe ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${wardrobe.slice(0, 80)}${wardrobe.length > 80 ? "…" : ""}</div>` : ""}
        ${voice ? `<span style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);padding:2px 6px;border-radius:2px;">⚡ ${voice}</span>` : ""}
      </div>
    </div>
  `;
}

// ─── Phase 7: Prompt Intelligence ─────────────────────────
function buildCinematicPrompt() {
  const charRecord = window.LEVRAM_ACTIVE_CHARACTER_RECORD;

  // PHASE 8H — visual override > character record > voice lab selection
  const character =
    document.getElementById("shot-char-override")?.value.trim() ||
    charRecord?.name ||
    getActiveCharacter() ||
    "main character";

  const shotType = document.getElementById("shot-type")?.value || "";
  const cameraMood = document.getElementById("shot-camera")?.value || "";
  const palette = document.getElementById("shot-palette")?.value || "";
  const description = document.getElementById("shot-desc")?.value.trim() || "";

  // PHASE 8H — pull appearance and wardrobe from active character record
  const charVisual = charRecord
    ? [charRecord.appearance, charRecord.wardrobe].filter(Boolean).join(", ")
    : "";

  const prompt = [
    description.toLowerCase().includes(character.toLowerCase())
      ? description
      : `${character}, ${description}`,
    charVisual,
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
    const btn = document.getElementById("btn-ai-build-shot");
    try {
      const idea =
        document.getElementById("ai-shot-idea")?.value.trim();

      if (!idea) {
        setStatus("Enter an AI Shot Idea first.", true);
        return;
      }

      if (btn) { btn.textContent = "Building..."; btn.disabled = true; }
      setStatus("Building shot...");

      const res = await levFetch(
        `${SB_BASE}/ai/build-shot`,
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
    } finally {
      if (btn) { btn.textContent = "AI Build Shot"; btn.disabled = false; }
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
    const btn = document.getElementById("btn-ai-revise-shot");
    try {
    const override =
      document.getElementById("ai-override-notes")?.value.trim();

    if (!override) {
      setStatus("Enter Override Instructions first.", true);
      return;
    }

    if (btn) { btn.textContent = "Revising..."; btn.disabled = true; }
    setStatus("Revising shot...");

    const res = await levFetch(
      `${SB_BASE}/ai/revise-shot`,
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
    } catch (err) {
      console.error("AI REVISE ERROR:", err);
      setStatus(err.message || "Revision failed.", true);
    } finally {
      if (btn) { btn.textContent = "AI Revise Shot"; btn.disabled = false; }
    }
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
    const res = await levFetch(`${SB_BASE}/characters`);
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

    async function updateSelectedCharacterPrompts() {
      const primary = characters[Number(select.value)];
      const secondary = secondarySelect
        ? characters[Number(secondarySelect.value)]
        : null;

      const primaryPrompt = primary ? levramCharacterText(primary) : "";
      const secondaryPrompt = secondary ? levramCharacterText(secondary) : "";

      window.LEVRAM_SELECTED_CHARACTER_PROMPT =
        [primaryPrompt, secondaryPrompt].filter(Boolean).join("\n\nSECONDARY CHARACTER:\n");

      // PHASE 8H — expose full character record for Shot Builder injection
      window.LEVRAM_ACTIVE_CHARACTER_RECORD = primary || null;


      renderCharacterPanel(primary);

      if (primary?.default_voice_profile) {
        window.LEVRAM_ACTIVE_VOICE_PROFILE = primary.default_voice_profile;

        try {
          const voiceRes = await levFetch(`${SB_BASE}/voices`);
          const voiceData = await voiceRes.json();
          const voices = voiceData.voices || [];

          window.LEVRAM_ACTIVE_VOICE_RECORD =
            voices.find(v => v.name === primary.default_voice_profile) || null;
        } catch (err) {
          console.error("PHASE 8F VOICE PROFILE RESOLVE FAILED:", err);
          window.LEVRAM_ACTIVE_VOICE_RECORD = null;
        }


      } else {
        window.LEVRAM_ACTIVE_VOICE_PROFILE = "";
        window.LEVRAM_ACTIVE_VOICE_RECORD = null;
      }
    }

    select.addEventListener("change", updateSelectedCharacterPrompts);

    if (secondarySelect) {
      secondarySelect.addEventListener("change", updateSelectedCharacterPrompts);
    }

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadLevramCharacters);
} else {
  loadLevramCharacters();
}

// ─── Send to Render Queue ─────────────────────────────────
document.getElementById("btn-send-to-queue")?.addEventListener("click", async () => {
  const shotPrompt = document.getElementById("shot-prompt-input")?.value.trim() || "";
  const dialogue   = document.getElementById("script-input")?.value.trim() || "";
  const character  = document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "";

  if (!shotPrompt && !dialogue) {
    setStatus("Build a shot first before adding to queue.", true);
    return;
  }

  try {
    // If we have a saved scene, use it; otherwise package current form state
    const payload = {
      shot: {
        id:              selectedSceneId || null,
        shot_number:     document.getElementById("shot-scene")?.value || "",
        project:         document.getElementById("shot-project")?.value || "",
        character:       character,
        dialogue:        dialogue,
        shotDesc:        document.getElementById("shot-desc")?.value.trim() || "",
        shot_prompt:     shotPrompt,
        voice_preset:    typeof getActiveFxPreset === "function" ? getActiveFxPreset() : "",
        rawUrl:          rawUrl || "",
        fxUrl:           fxUrl  || "",
      }
    };

    const res = await levFetch(`${SB_BASE}/render-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Queue add failed");
    setStatus(`Shot added to Render Queue (${data.queue.length} total).`);
  } catch (err) {
    console.error("SEND TO QUEUE ERROR:", err);
    setStatus(err.message || "Failed to add to queue.", true);
  }
});

// ─── Keyframe → open Image Gen with shot prompt pre-filled ──
document.getElementById("btn-shot-keyframe")?.addEventListener("click", () => {
  const prompt    = document.getElementById("shot-prompt-input")?.value.trim() || "";
  const character = document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "";
  const aspect    = (() => {
    const dur = document.getElementById("shot-duration")?.value || "4s";
    return "widescreen"; // shots are always widescreen
  })();

  if (!prompt) {
    setStatus("Generate a shot prompt first.", true);
    return;
  }

  // Pre-fill Image Gen
  const igPrompt    = document.getElementById("ig-prompt");
  const igCharacter = document.getElementById("ig-character");
  const igAspect    = document.getElementById("ig-aspect");

  if (igPrompt)    igPrompt.value    = prompt;
  if (igCharacter && character) {
    const opt = [...igCharacter.options].find(o => o.value === character);
    if (opt) igCharacter.value = character;
  }
  if (igAspect)    igAspect.value    = aspect;

  // Switch to Image Gen tab (image mode)
  if (window.showTab) {
    window.showTab("image-gen");
    document.querySelectorAll(".nav-btn[data-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === "image-gen");
    });
    // Ensure image mode
    const modeToggle = document.getElementById("ig-mode-toggle");
    if (modeToggle) {
      modeToggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.mode === "image");
      });
      if (typeof igApplyMode === "function") {
        window.__igActiveMode = "image";
      }
    }
  }

  setStatus("Prompt sent to Image Gen → click Generate Image.");
});

// ─── Wan Video → open Image Gen in video mode with shot prompt ─
document.getElementById("btn-shot-wan-video")?.addEventListener("click", () => {
  const prompt    = document.getElementById("shot-prompt-input")?.value.trim() || "";
  const character = document.getElementById("shot-character")?.selectedOptions?.[0]?.textContent || "";

  if (!prompt) {
    setStatus("Generate a shot prompt first.", true);
    return;
  }

  const igPrompt    = document.getElementById("ig-prompt");
  const igCharacter = document.getElementById("ig-character");

  if (igPrompt)    igPrompt.value = prompt;
  if (igCharacter && character) {
    const opt = [...igCharacter.options].find(o => o.value === character);
    if (opt) igCharacter.value = character;
  }

  // Switch to Image Gen tab and set video mode
  if (window.showTab) {
    window.showTab("image-gen");
    document.querySelectorAll(".nav-btn[data-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === "image-gen");
    });
  }

  // Activate video mode toggle
  const modeToggle = document.getElementById("ig-mode-toggle");
  if (modeToggle) {
    modeToggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => {
      const isVideo = b.dataset.mode === "video";
      b.classList.toggle("active", isVideo);
    });
  }
  // Trigger mode apply
  const imageSection = document.getElementById("ig-image-section");
  const videoSection = document.getElementById("ig-video-section");
  const styleGroup   = document.getElementById("ig-style-group");
  const genBtn       = document.getElementById("ig-generate-btn");
  const videoGallery = document.getElementById("ig-video-gallery-section");
  if (imageSection) imageSection.style.display = "none";
  if (videoSection) videoSection.style.display = "block";
  if (styleGroup)   styleGroup.style.display   = "none";
  if (genBtn)       genBtn.textContent = "Generate Video";
  if (videoGallery) videoGallery.style.display  = "block";

  setStatus("Prompt sent to Video Gen → click Generate Video.");
});

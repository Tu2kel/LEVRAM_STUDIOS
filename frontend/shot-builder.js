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
            const character = getActiveCharacter();
            const dialogue = document
              .getElementById("script-input")
              .value.trim();

            const payload = {
              project: document.getElementById("shot-project").value,
              scene_number: document.getElementById("shot-scene").value.trim(),
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
              character: character,
              duration: document.getElementById("shot-duration").value,
              voice_character: character,
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

document.currentScript.insertAdjacentHTML(
              "afterend",
              Array.from({ length: 80 }, (_, i) => {
                const h = Math.max(4, Math.round(Math.random() * 22));
                const delay = (i * 0.015).toFixed(3);
                return `<div class="wave-bar" style="height:${h}px;animation-delay:${delay}s;opacity:${0.3 + Math.random() * 0.5}"></div>`;
              }).join(""),
            );

// ─── State ───────────────────────────────────────────────
      let rawUrl = null;
      let rawPath = null;
      let fxUrl = null;
      let fxPath = null;
      let shots = [];
      let selectedSceneId = null;
      let renderQueue = [];
      const BASE = "http://localhost:8000";

      // ─── DOM refs ────────────────────────────────────────────
      const statusEl = document.getElementById("status-text");
      const previewMain = document.getElementById("preview-main");
      const metaChar = document.getElementById("meta-char");
      const metaPreset = document.getElementById("meta-preset");
      const metaFxStatus = document.getElementById("meta-fx-status");
      const metaDuration = document.getElementById("meta-duration");
      const dlRaw = document.getElementById("dl-raw");
      const dlFx = document.getElementById("dl-fx");
      const waveformArea = document.getElementById("waveform-area");
      const voiceTrackBody = document.getElementById("track-voice-body");
      const fxTrackBody = document.getElementById("track-fx-body");
      const shotTrackBody = document.getElementById("track-shot-body");
      const timelineShots = document.getElementById("timeline-shots");
      const tlTime = document.getElementById("tl-time");

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

        setStatus(`Loaded ${scene.id} for editing.`);
      }

      // ─── Helpers ─────────────────────────────────────────────
      function setStatus(msg, isErr = false) {
        statusEl.textContent = msg;
        statusEl.style.background = isErr
          ? "linear-gradient(90deg,#7a0000,#cc0000)"
          : "linear-gradient(90deg,#8b6914,#c9a84c,#f5d98b)";
        statusEl.style.webkitBackgroundClip = "text";
        statusEl.style.webkitTextFillColor = "transparent";
        statusEl.style.backgroundClip = "text";
      }

      function activateWaveform() {
        waveformArea.innerHTML =
          '<span style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--text-dim);font-weight:600;margin-right:12px;white-space:nowrap;">Waveform</span>';
        for (let i = 0; i < 80; i++) {
          const bar = document.createElement("div");
          bar.className = "wave-bar";
          const h = Math.max(4, Math.round(Math.random() * 22));
          bar.style.cssText = `height:${h}px;animation-delay:${(i * 0.015).toFixed(3)}s;opacity:${(0.3 + Math.random() * 0.5).toFixed(2)};background:var(--gold)`;
          waveformArea.appendChild(bar);
        }
      }

      function flattenWaveform() {
        document.querySelectorAll(".wave-bar").forEach((b) => {
          b.style.height = "4px";
          b.style.background = "var(--text-dim)";
        });
      }

      function showAudioInPreview(url, label, color) {
        previewMain.innerHTML = `
      <div style="width:90%;text-align:center;">
        <p style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${color};font-weight:700;margin-bottom:12px;">${label}</p>
        <audio controls src="${url}" style="width:100%;"></audio>
      </div>`;
      }

      function getActiveFxPreset() {
        return document.querySelector("select.fx-preset").value;
      }

      function getActiveCharacter() {
        const active = document.querySelector(".char-btn.active");
        return active ? active.textContent.trim() : "Default";
      }

      function fmtTime(sec) {
        const h = Math.floor(sec / 3600)
          .toString()
          .padStart(2, "0");
        const m = Math.floor((sec % 3600) / 60)
          .toString()
          .padStart(2, "0");
        const s = Math.floor(sec % 60)
          .toString()
          .padStart(2, "0");
        return `${h}:${m}:${s}`;
      }

      // ─── Character preset buttons ────────────────────────────
      document.querySelectorAll(".char-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll(".char-btn")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          metaChar.textContent = btn.textContent.trim();
        });
      });

      // ─── Nav buttons ─────────────────────────────────────────
      document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll(".nav-btn")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      // ─── Generate Voice ──────────────────────────────────────
      document
        .getElementById("btn-generate")
        .addEventListener("click", async () => {
          const text = document.getElementById("script-input").value.trim();
          const character = getActiveCharacter();

          if (!text) {
            setStatus("Enter dialogue first.", true);
            return;
          }

          setStatus("Generating voice...");
          flattenWaveform();
          rawUrl = null;
          fxUrl = null;
          metaFxStatus.textContent = "Pending";
          metaFxStatus.className = "meta-val red";

          try {
            const fd = new FormData();
            fd.append("text", text);
            fd.append("character", character);

            const res = await fetch(`${BASE}/generate`, {
              method: "POST",
              body: fd,
            });
            if (!res.ok) throw new Error(`Server ${res.status}`);
            const data = await res.json();

            rawPath =
              data.output_url ||
              "/" + data.output_path?.replace(/\\/g, "/") ||
              null;
            if (!rawPath) throw new Error("No path in response");
            rawUrl = BASE + rawPath;

            // Update meta
            metaChar.textContent = character;
            metaPreset.textContent = getActiveFxPreset();

            // Preview + waveform
            showAudioInPreview(
              rawUrl,
              "Raw Voice — " + character,
              "var(--gold)",
            );
            activateWaveform();

            // Voice track clip
            voiceTrackBody.innerHTML = `<div class="track-clip voice">${character} — "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"</div>`;

            // Duration from audio element
            const tmpAudio = new Audio(rawUrl);
            tmpAudio.addEventListener("loadedmetadata", () => {
              const dur = fmtTime(tmpAudio.duration);
              metaDuration.textContent = dur;
              tlTime.textContent = `00:00:00 / ${dur}`;
            });

            // Download button
            dlRaw.href = rawUrl;
            dlRaw.style.opacity = "1";
            dlRaw.style.pointerEvents = "auto";

            setStatus("Voice generated.");
          } catch (e) {
            setStatus("Error: " + e.message, true);
          }
        });

      // ─── Apply Voice FX ──────────────────────────────────────
      document.getElementById("btn-fx").addEventListener("click", async () => {
        if (!rawPath) {
          setStatus("Generate raw voice first.", true);
          return;
        }

        const preset = getActiveFxPreset();
        setStatus("Applying FX...");
        metaFxStatus.textContent = "Processing...";
        metaFxStatus.className = "meta-val";

        try {
          const fd = new FormData();
          fd.append("input_path", rawPath);
          fd.append("preset", preset);

          const res = await fetch(`${BASE}/voice-fx`, {
            method: "POST",
            body: fd,
          });
          if (!res.ok) throw new Error(`Server ${res.status}`);
          const data = await res.json();

          fxPath =
            data.output_url ||
            "/" + data.output_path?.replace(/\\/g, "/") ||
            null;
          if (!fxPath) throw new Error("No path in response");
          fxUrl = BASE + fxPath;

          // Update meta
          metaPreset.textContent = preset;
          metaFxStatus.textContent = "Applied ✓";
          metaFxStatus.className = "meta-val";
          metaFxStatus.style.color = "#2ecc71";

          // Preview
          showAudioInPreview(
            fxUrl,
            "FX Voice — " + preset.toUpperCase(),
            "var(--blue-bright)",
          );
          activateWaveform();

          // FX track clip
          fxTrackBody.innerHTML = `<div class="track-clip fx">${preset} preset</div>`;

          // Download button
          dlFx.href = fxUrl;
          dlFx.style.opacity = "1";
          dlFx.style.pointerEvents = "auto";

          setStatus("FX applied.");
        } catch (e) {
          setStatus("Error: " + e.message, true);
          metaFxStatus.textContent = "Error";
          metaFxStatus.className = "meta-val red";
        }
      });

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

      // ─── Load saved scenes from backend ───────────────────────
      async function loadScenes() {
        try {
          const res = await fetch("http://localhost:8000/scenes");
          const data = await res.json();

          if (!data.success) {
            throw new Error("Failed to load scenes");
          }

          shots = data.scenes.map((s) => ({
            id: s.id || Date.now(),
            sceneNum: (s.scene_number || s.id || "???").replace("SC-", ""),
            character: s.character || s.voice_character || "Unknown",
            dialogue: s.dialogue || "",
            shotDesc: s.shot_description || "",
            shotPrompt: s.shot_prompt || "",
            project: s.project || "",
            cameraMood: s.camera_mood || "",
            palette: s.color_palette || "",
            engine: s.ai_engine || "",
            preset: s.voice_preset || "",
            rawUrl: s.rawUrl || "",
            fxUrl: s.fxUrl || "",
            createdAt: s.saved_at || "",
          }));

          renderTimeline();
        } catch (e) {
          console.error(e);
          renderTimeline();
          setStatus("Could not load saved scenes", true);
        }
      }

      // ─── Delete shot ─────────────────────────────────────────
      window.deleteShot = async function (id) {
        try {
          const res = await fetch(`${BASE}/scene/${id}`, {
            method: "DELETE",
          });

          const data = await res.json();

          if (!data.success) {
            throw new Error("Failed to delete scene");
          }

          await loadScenes();
          setStatus(`Scene ${id} deleted.`);
        } catch (e) {
          console.error(e);
          setStatus(`Failed to delete scene ${id}`, true);
        }
      };

      // ─── Clear history ───────────────────────────────────────
      document.getElementById("btn-clear").addEventListener("click", () => {
        shots = [];
        try {
          localStorage.removeItem("levram_shots");
        } catch {}
        voiceTrackBody.innerHTML = "";
        fxTrackBody.innerHTML = "";
        renderTimeline();
        setStatus("History cleared.");
      });

      // ─── Download buttons initial state ──────────────────────
      dlRaw.style.opacity = "0.3";
      dlRaw.style.pointerEvents = "none";
      dlFx.style.opacity = "0.3";
      dlFx.style.pointerEvents = "none";

      // ─── Theme toggle ─────────────────────────────────────────
      const savedTheme = localStorage.getItem("levram-theme") || "dark";
      document.documentElement.setAttribute("data-theme", savedTheme);

      const themeToggle = document.getElementById("theme-toggle");

      if (themeToggle) {
        themeToggle.textContent =
          savedTheme === "ivory" ? "Dark Mode" : "Ivory Mode";

        themeToggle.addEventListener("click", () => {
          const current =
            document.documentElement.getAttribute("data-theme") || "dark";

          const next = current === "ivory" ? "dark" : "ivory";

          document.documentElement.setAttribute("data-theme", next);
          localStorage.setItem("levram-theme", next);

          themeToggle.textContent =
            next === "ivory" ? "Dark Mode" : "Ivory Mode";
        });
      }

      // ─── Init ─────────────────────────────────────────────────
      loadScenes();

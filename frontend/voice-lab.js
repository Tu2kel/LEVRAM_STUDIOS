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

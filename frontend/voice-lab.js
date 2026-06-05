// ─── Generate Voice ──────────────────────────────────────
      document
        .getElementById("btn-generate")
        .addEventListener("click", async () => {
          const text = document.getElementById("script-input").value.trim();
          // PHASE 8F.3 — consume active voice record from Shot Builder character selection
          let character;
          const _avr = window.LEVRAM_ACTIVE_VOICE_RECORD;
          if (_avr) {
            console.log("PHASE 8F.3 ACTIVE VOICE CONSUMED", _avr);
            character = _avr.character || _avr.name || getActiveCharacter();
          } else {
            console.log("PHASE 8F.3 FALLBACK MANUAL VOICE");
            character = getActiveCharacter();
          }

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

// ===============================
// PHASE 8E — VOICE LIBRARY
// ===============================

async function loadVoiceLibrary() {
  const list = document.getElementById("voice-library-list");
  if (!list) return;

  try {
    const res = await fetch(`${BASE}/voices`);
    const data = await res.json();
    const voices = data.voices || [];

    if (!voices.length) {
      list.innerHTML = `<div class="character-empty">No saved voices yet.</div>`;
      return;
    }

    list.innerHTML = voices.map(v => `
      <div class="saved-voice-row">
        <div class="saved-voice-main">
          <div class="saved-voice-name">⚜ ${v.name || "Unnamed Voice"}</div>
          <div class="saved-voice-meta">${v.character || "No character"} • ${v.preset || "No FX"}</div>
        </div>

        <div class="saved-voice-actions">
          ${v.fxUrl ? `<a class="saved-voice-link" href="${v.fxUrl}" target="_blank">Open FX</a>` : ""}
          ${v.rawUrl ? `<a class="saved-voice-link" href="${v.rawUrl}" target="_blank">Open Raw</a>` : ""}
          <button
            type="button"
            class="saved-voice-delete"
            onclick="deleteVoiceProfile('${v.id}')"
          >
            Delete
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("LOAD VOICE LIBRARY ERROR:", err);
    list.innerHTML = `<div class="character-empty">Could not load saved voices.</div>`;
  }
}

async function saveVoiceProfile() {
  const name = document.getElementById("voice-name")?.value.trim() || "";
  const character = typeof getActiveCharacter === "function"
    ? getActiveCharacter()
    : "";

  if (!name) {
    setStatus("Enter a voice name first.", true);
    return;
  }

  if (!rawUrl && !fxUrl) {
    setStatus("Generate voice before saving.", true);
    return;
  }

  const payload = {
    name,
    character,
    rawUrl: rawUrl || "",
    fxUrl: fxUrl || "",
    preset: typeof getActiveFxPreset === "function"
      ? getActiveFxPreset()
      : ""
  };

  try {
    const res = await fetch(`${BASE}/voices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || data.error || "Save voice failed");
    }

    setStatus(`Voice saved: ${name}`);
    await loadVoiceLibrary();
  } catch (err) {
    console.error("SAVE VOICE ERROR:", err);
    setStatus(err.message || "Save voice failed.", true);
  }
}

async function deleteVoiceProfile(id) {
  if (!id) return;

  try {
    const res = await fetch(`${BASE}/voices/${id}`, {
      method: "DELETE"
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || data.error || "Delete voice failed");
    }

    setStatus("Voice deleted.");
    await loadVoiceLibrary();
  } catch (err) {
    console.error("DELETE VOICE ERROR:", err);
    setStatus(err.message || "Delete voice failed.", true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("btn-save-voice");
  if (saveBtn) saveBtn.addEventListener("click", saveVoiceProfile);
  loadVoiceLibrary();
});

window.loadVoiceLibrary = loadVoiceLibrary;
window.saveVoiceProfile = saveVoiceProfile;
window.deleteVoiceProfile = deleteVoiceProfile;

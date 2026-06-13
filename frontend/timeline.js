// ─── Render timeline shot clips ──────────────────────────
      function getShotNumber(index) {
        return `SC-${String(index + 1).padStart(3, "0")}`;
      }

      function renumberShots() {
        shots = shots.map((shot, index) => ({
          ...shot,
          shot_number: getShotNumber(index),
        }));
      }

      async function saveTimelineOrder() {
        try {
          renumberShots();

          const res = await levFetch(`${BASE}/timeline/save-order`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ shots }),
          });

          if (!res.ok) throw new Error(`Server ${res.status}`);

          const data = await res.json();
          shots = data.shots || shots;
          renderTimeline();

          setStatus(`Timeline order saved. ${shots.length} shots sequenced.`);
        } catch (e) {
          console.error(e);
          setStatus("Failed to save timeline order.", true);
        }
      }

      let draggedShotId = null;

      function moveShot(id, direction) {
        const index = shots.findIndex((s) => s.id === id);
        if (index === -1) return;

        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= shots.length) return;

        const temp = shots[index];
        shots[index] = shots[newIndex];
        shots[newIndex] = temp;

        renumberShots();
        renderTimeline();
      }

      function handleDragStart(e, id) {
        draggedShotId = id;
        e.currentTarget.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      }

      function handleDragEnd(e) {
        e.currentTarget.classList.remove("dragging");
        document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
        draggedShotId = null;
      }

      function handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add("drop-target");
      }

      function handleDragLeave(e) {
        e.currentTarget.classList.remove("drop-target");
      }

      function handleDrop(e, targetId) {
        e.preventDefault();

        if (!draggedShotId || draggedShotId === targetId) return;

        const fromIndex = shots.findIndex((s) => s.id === draggedShotId);
        const toIndex = shots.findIndex((s) => s.id === targetId);

        if (fromIndex === -1 || toIndex === -1) return;

        const [movedShot] = shots.splice(fromIndex, 1);
        shots.splice(toIndex, 0, movedShot);

        document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
        draggedShotId = null;
        renumberShots();
        renderTimeline();
      }


      function renderTimeline() {
        if (shots.length === 0) {
          shotTrackBody.innerHTML = "";
          timelineShots.innerHTML =
            '<p style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No shots saved yet.</p>';
          return;
        }

        const recent = shots.slice(0, 4);
        const segW = Math.floor(90 / recent.length);

        shotTrackBody.innerHTML = recent
          .map(
            (s, i) =>
              `<div class="track-clip shot" style="left:${2 + i * segW}%;width:${segW - 1}%;">${s.shot_number || s.id || s.sceneNum || s.scene_number || 'UNKNOWN'}</div>`,
          )
          .join("");

        timelineShots.innerHTML = shots
          .map(
            (s, index) => `
      <div class="tl-shot-card"
        draggable="true"
        data-id="${s.id}"
        ondragstart="handleDragStart(event, '${s.id}')"
        ondragend="handleDragEnd(event)"
        ondragover="handleDragOver(event)"
        ondragleave="handleDragLeave(event)"
        ondrop="handleDrop(event, '${s.id}')"
        onclick="loadSceneIntoEditor(shots.find(x => x.id === '${s.id}'))">
        <div class="tl-shot-top">
          <span class="tl-scene-badge" style="cursor:grab;">☰ ${s.shot_number || s.id || s.sceneNum || s.scene_number || 'UNKNOWN'}</span>
          <span class="tl-char-tag">${s.character || "Unknown"}</span>
          <span class="tl-preset-tag">${s.preset || s.voice_preset || "No FX"}</span>
          <span class="tl-date">${s.createdAt || ""}</span>

          <button class="tl-del-btn" title="Move Up" onclick="event.stopPropagation(); moveShot('${s.id}', -1)">↑</button>
          <button class="tl-del-btn" title="Move Down" onclick="event.stopPropagation(); moveShot('${s.id}', 1)">↓</button>
          <button class="tl-del-btn" title="Assemble image + voice → clip" onclick="event.stopPropagation(); tlAssembleShot('${s.id}')">⚡</button>
          <button class="tl-del-btn" title="Delete" onclick="event.stopPropagation(); deleteShot('${s.id}')">✕</button>
        </div>

        ${s.dialogue ? `<div class="tl-dialogue">"${s.dialogue}"</div>` : ""}
        ${s.shotDesc || s.shot_description ? `<div class="tl-desc">${s.shotDesc || s.shot_description}</div>` : ""}
        ${s.shotPrompt || s.shot_prompt ? `<div class="tl-prompt">${s.shotPrompt || s.shot_prompt}</div>` : ""}
        ${s.fxUrl ? `<audio controls src="${s.fxUrl}" style="width:100%;margin-top:6px;"></audio>` : s.rawUrl ? `<audio controls src="${s.rawUrl}" style="width:100%;margin-top:6px;"></audio>` : ""}
      </div>
    `,
          )
          .join("");

        timelineShots.scrollTop = timelineShots.scrollHeight;
      }

      document
        .getElementById("btn-save-timeline-order")
        .addEventListener("click", saveTimelineOrder);

      // ── Assemble shot: image + voice → static MP4 clip (no AI animation) ──
      window.tlAssembleShot = async function tlAssembleShot(id) {
        const shot = shots.find(s => s.id === id);
        if (!shot) return;
        const hasImage = shot.renderOutputUrl || shot.renderOutputPath;
        const hasAudio = shot.fxUrl || shot.rawUrl;
        if (!hasImage || !hasAudio) {
          setStatus("Need both a keyframe image and voice audio to assemble.", true);
          return;
        }
        setStatus(`Assembling ${shot.shot_number || id}…`);
        try {
          const res  = await levFetch(`${BASE}/video/assemble-shot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ item_id: id }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.detail || "Assemble failed");
          // Patch local shot with clip URL so timeline shows it immediately
          const local = shots.find(s => s.id === id);
          if (local) local.clipUrl = data.clipUrl;
          renderTimeline();
          setStatus(`${shot.shot_number || id} assembled → ${data.clipUrl.split("/").pop()}`);
        } catch (err) {
          setStatus("Assemble failed: " + err.message, true);
        }
      };

      // ── Export modal ──────────────────────────────────────────
      async function tlLoadMusicLibrary() {
        try {
          const res  = await levFetch(`${BASE}/music/library`);
          const data = await res.json();
          const sel  = document.getElementById("tl-export-music-sel");
          if (!sel) return;
          (data.tracks || []).forEach(t => {
            const o = document.createElement("option");
            o.value = t.url; o.textContent = t.title || t.filename || t.url.split("/").pop();
            sel.appendChild(o);
          });
        } catch (_) {}
      }

      window.tlOpenExportModal = function tlOpenExportModal() {
        const videoShots = shots.filter(s => s.videoUrl || s.renderOutputUrl || s.clipUrl);
        const voiceShots = shots.filter(s => s.fxUrl || s.rawUrl);
        const modal = document.getElementById("tl-export-modal");
        if (!modal) return;
        document.getElementById("tl-export-clip-count").textContent  = videoShots.length;
        document.getElementById("tl-export-voice-count").textContent = voiceShots.length;
        tlLoadMusicLibrary();
        modal.style.display = "flex";
      };

      window.tlCloseExportModal = function tlCloseExportModal() {
        const modal = document.getElementById("tl-export-modal");
        if (modal) modal.style.display = "none";
      };

      window.tlRunExport = async function tlRunExport() {
        const videoShots = shots.filter(s => s.videoUrl || s.renderOutputUrl || s.clipUrl);
        if (!videoShots.length) {
          alert("No animated clips in timeline yet.");
          return;
        }

        const title        = document.getElementById("tl-export-title")?.value.trim()     || "LEVRAM_Export";
        const musicUrl     = document.getElementById("tl-export-music-sel")?.value        || "";
        const musicVolume  = parseFloat(document.getElementById("tl-export-music-vol")?.value ?? "0.2");
        const includeVoice = document.getElementById("tl-export-voice-chk")?.checked      ?? true;
        const transition   = document.getElementById("tl-export-transition")?.value       || "none";
        const colorGrade   = document.getElementById("tl-export-grade")?.value            || "";
        const speed        = parseFloat(document.getElementById("tl-export-speed")?.value ?? "1.0");
        const captions     = document.getElementById("tl-export-captions")?.checked       ?? false;
        const titleClip    = document.getElementById("tl-export-title-clip")?.value.trim() || "";

        const btn    = document.getElementById("tl-export-run-btn");
        const status = document.getElementById("tl-export-status");

        const hasEffects = transition !== "none" || colorGrade || captions || speed !== 1.0;
        if (btn)    { btn.disabled = true; btn.textContent = `Exporting ${videoShots.length} clips…`; btn.classList.add("lora-scanning"); }
        if (status) status.textContent = hasEffects ? "Applying effects + mixing audio (this takes a moment)…" : "Downloading clips and mixing audio…";

        try {
          const res  = await levFetch(`${BASE}/video/export-timeline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title, music_url: musicUrl, music_volume: musicVolume, include_voice: includeVoice,
              transition, transition_dur: 0.5, color_grade: colorGrade, captions, speed,
              title_clip: titleClip,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.detail || "Export failed");

          const apiBase = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";
          const fullUrl = apiBase + data.exportUrl;

          const parts = [`${data.clips} clips`];
          if (data.voice_tracks) parts.push(`${data.voice_tracks} voice tracks`);
          if (data.music)        parts.push("music mixed");
          if (status) status.textContent = `✔ Done — ${parts.join(" · ")}`;
          if (btn) { btn.disabled = false; btn.textContent = "Export Again"; btn.classList.remove("lora-scanning"); }

          // Show in-app preview
          const preview = document.getElementById("tl-export-preview");
          const vidEl   = document.getElementById("tl-export-video");
          const dlLink  = document.getElementById("tl-export-dl-link");
          if (preview && vidEl) {
            vidEl.src = fullUrl;
            if (dlLink) { dlLink.href = fullUrl; dlLink.download = data.exportUrl.split("/").pop(); }
            preview.style.display = "block";
            vidEl.play().catch(() => {});
          } else {
            // Fallback: auto-download
            const a = document.createElement("a");
            a.href = fullUrl; a.download = data.exportUrl.split("/").pop(); a.click();
          }
        } catch (err) {
          if (status) status.textContent = "Export failed: " + err.message;
          if (btn)    { btn.disabled = false; btn.textContent = "⬇ Export Final Video"; btn.classList.remove("lora-scanning"); }
          console.error("TL EXPORT ERROR:", err);
        }
      };

      // Wire export button to modal opener
      document.getElementById("btn-export-timeline")?.addEventListener("click", tlOpenExportModal);

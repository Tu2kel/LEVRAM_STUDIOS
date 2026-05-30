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

          const res = await fetch(`${BASE}/timeline/save-order`, {
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
              `<div class="track-clip shot" style="left:${2 + i * segW}%;width:${segW - 1}%;">${s.shot_number || s.id || s.sceneNum || 'UNKNOWN'}</div>`,
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
          <span class="tl-scene-badge" style="cursor:grab;">☰ ${s.shot_number || s.id || s.sceneNum || 'UNKNOWN'}</span>
          <span class="tl-char-tag">${s.character || "Unknown"}</span>
          <span class="tl-preset-tag">${s.preset || s.voice_preset || "No FX"}</span>
          <span class="tl-date">${s.createdAt || ""}</span>

          <button class="tl-del-btn" title="Move Up" onclick="event.stopPropagation(); moveShot('${s.id}', -1)">↑</button>
          <button class="tl-del-btn" title="Move Down" onclick="event.stopPropagation(); moveShot('${s.id}', 1)">↓</button>
          <button class="tl-del-btn" title="Queue Render" onclick="event.stopPropagation(); addShotToRenderQueue('${s.id}')">🎬</button>
          <button class="tl-del-btn" title="Delete" onclick="event.stopPropagation(); deleteShot('${s.id}')">✕</button>
        </div>

        ${s.dialogue ? `<div class="tl-dialogue">"${s.dialogue}"</div>` : ""}
        ${s.shotDesc ? `<div class="tl-desc">${s.shotDesc}</div>` : ""}
        ${s.shotPrompt ? `<div class="tl-prompt">${s.shotPrompt}</div>` : ""}
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

      document
        .getElementById("btn-clear-render-queue")
        .addEventListener("click", clearRenderQueue);

      loadRenderQueue();

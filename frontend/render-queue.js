async function addShotToRenderQueue(id) {
  try {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;

    const res = await fetch(`${BASE}/render-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shot }),
    });

    if (!res.ok) throw new Error(`Server ${res.status}`);
    const data = await res.json();
    renderQueue = data.queue || data.jobs || data.items || [];
    renderRenderQueue();
    setStatus(`${shot.shot_number || shot.id} added to render queue.`);
  } catch (e) {
    console.error(e);
    setStatus("Failed to add shot to render queue.", true);
  }
}

async function loadRenderQueue() {
  try {
    const res = await fetch(`${BASE}/render-queue`);
    if (!res.ok) throw new Error(`Server ${res.status}`);
    const data = await res.json();

    renderQueue = data.queue || data.jobs || data.items || [];

    console.log("RQ API DATA:", data);
    console.log("RQ LOADED:", renderQueue.length);
  } catch (e) {
    console.error("RQ API failed:", e);
    renderQueue = [];
  }

  renderRenderQueue();
}

async function clearRenderQueue() {
  try {
    const res = await fetch(`${BASE}/render-queue/clear`, { method: "POST" });
    if (!res.ok) throw new Error(`Server ${res.status}`);
    renderQueue = [];
    renderRenderQueue();
    setStatus("Render queue cleared.");
  } catch (e) {
    console.error(e);
    setStatus("Failed to clear render queue.", true);
  }
}

function renderRenderQueue() {
  const panel = document.getElementById("render-queue-panel");
  const count = document.getElementById("rq-count");
  if (!panel || !count) return;

  count.textContent = `${renderQueue.length} Job${renderQueue.length !== 1 ? "s" : ""}`;

  if (!renderQueue.length) {
    panel.innerHTML = `<div class="rq-empty">Queue empty — API returned 0 jobs</div>`;
    return;
  }

  panel.innerHTML = renderQueue
    .map((item) => {
      const shot = item.shot || item || {};
      const status = item.status || "pending";
      const title =
        shot.shot_number ||
        item.shot_number ||
        shot.scene ||
        shot.id ||
        "UNKNOWN";

      const sub =
        shot.shotDesc ||
        shot.shot_description ||
        item.shotDesc ||
        item.shot_description ||
        shot.title ||
        "Untitled Shot";

      const char =
        shot.character ||
        item.character ||
        shot.voice_character ||
        "";

      const preset =
        shot.preset ||
        item.preset ||
        shot.voice_preset ||
        "";

      return `
      <div class="rq-job-card">
        <div>
          <div class="rq-job-title">${title}${char ? " · " + char : ""}${preset ? " · " + preset : ""}</div>
          <div class="rq-job-sub">${sub}</div>
          ${shot.dialogue ? `<div class="tl-dialogue" style="margin-top:8px;">"${String(shot.dialogue).slice(0, 80)}${String(shot.dialogue).length > 80 ? "…" : ""}"</div>` : ""}
          ${item.renderOutputUrl ? `
            <img class="rq-thumb" src="${BASE}${item.renderOutputUrl}" alt="Generated keyframe" onclick="window.location.href='render-viewer.html?id=${item.id}'">
            <div class="rq-prompt">
              <strong>Prompt Used:</strong>
              ${item.promptUsed || "Not recorded"}
            </div>
          ` : ""}
        </div>

            ${item.clipUrl ? `
            <video class="rq-clip" src="${BASE}${item.clipUrl}" controls style="width:100%;max-height:140px;border-radius:4px;margin-top:8px;background:#000;"></video>
          ` : ""}
        </div>

        <div class="rq-job-right">
          <div class="render-status-pill render-status-${status}">${status}</div>
          <div class="render-actions">
            <button onclick="generateKeyframeForQueueItem('${item.id}')">Keyframe</button>
            <button onclick="assembleShotVideo('${item.id}')" ${!item.renderOutputUrl || !item.voicePath ? 'title="Need keyframe + voice first"' : ""}>Render Clip</button>
            <button onclick="deleteRenderQueueItem('${item.id}')">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function startRenderQueueItem(itemId) {
  try {
    const res = await fetch(`${BASE}/render-queue/${itemId}/start`, {
      method: "POST",
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Render start failed");
      return;
    }

    loadRenderQueue();
  } catch (err) {
    alert("Render start error: " + err.message);
  }
}

async function generateKeyframeForQueueItem(itemId) {
  try {
    const res = await fetch(`${BASE}/render-queue/${itemId}/keyframe`, {
      method: "POST",
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Keyframe generation failed");
      return;
    }

    loadRenderQueue();
  } catch (err) {
    alert("Keyframe error: " + err.message);
  }
}

async function updateRenderStatus(itemId, status) {
  try {
    const res = await fetch(`${BASE}/render-queue/${itemId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Status update failed");
      return;
    }

    loadRenderQueue();
  } catch (err) {
    alert("Render status error: " + err.message);
  }
}

async function deleteRenderQueueItem(itemId) {
  try {
    const res = await fetch(`${BASE}/render-queue/${itemId}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Delete failed");
      return;
    }

    loadRenderQueue();
  } catch (err) {
    alert("Delete error: " + err.message);
  }
}

// ─── Lane 1: Render one shot clip (image + voice → .mp4) ────

async function assembleShotVideo(itemId) {
  const item = renderQueue.find(i => i.id === itemId);
  if (!item) return;

  if (!item.renderOutputUrl) {
    alert("Generate a keyframe for this shot first.");
    return;
  }
  if (!item.voicePath) {
    alert("No voice audio found for this shot. Generate voice first.");
    return;
  }

  const btn = document.querySelector(`.render-actions button[onclick="assembleShotVideo('${itemId}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Rendering…"; }

  try {
    const res = await fetch(`${BASE}/video/assemble-shot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Assembly failed");
    await loadRenderQueue();
  } catch (err) {
    alert("Render Clip error: " + err.message);
    if (btn) { btn.disabled = false; btn.textContent = "Render Clip"; }
  }
}

// ─── Lane 1: Export full episode (concat all clips) ─────────

async function assembleEpisode() {
  const ready = renderQueue.filter(i => i.clipUrl);
  if (!ready.length) {
    alert("Render individual shot clips first, then export episode.");
    return;
  }

  const titleEl = document.getElementById("ep-title-input");
  const title   = titleEl?.value.trim() || "episode";
  const btn     = document.getElementById("export-episode-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Exporting…"; }

  try {
    const res = await fetch(`${BASE}/video/assemble-episode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Export failed");

    const episodeUrl = BASE + data.episodeUrl;
    const statusEl   = document.getElementById("ep-status");
    if (statusEl) {
      statusEl.innerHTML = `Episode ready — <a href="${episodeUrl}" download style="color:var(--gold);">Download ${data.episodeUrl.split("/").pop()}</a> (${data.clips} clips)`;
    } else {
      alert(`Episode ready: ${episodeUrl}`);
    }
  } catch (err) {
    alert("Export Episode error: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Export Episode"; }
  }
}

window.loadRenderQueue = loadRenderQueue;
window.startRenderQueueItem = startRenderQueueItem;
window.generateKeyframeForQueueItem = generateKeyframeForQueueItem;
window.updateRenderStatus = updateRenderStatus;
window.deleteRenderQueueItem = deleteRenderQueueItem;
window.assembleShotVideo = assembleShotVideo;
window.assembleEpisode   = assembleEpisode;

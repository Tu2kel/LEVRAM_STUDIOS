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
        </div>

        <div class="rq-job-right">
          <div class="render-status-pill render-status-${status}">${status}</div>
          <div class="render-actions">
            <button onclick="updateRenderStatus('${item.id}','rendering')">Start</button>
            <button onclick="updateRenderStatus('${item.id}','complete')">Complete</button>
            <button onclick="updateRenderStatus('${item.id}','failed')">Failed</button>
            <button onclick="deleteRenderQueueItem('${item.id}')">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
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

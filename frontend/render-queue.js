async function addShotToRenderQueue(id) {
  try {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;

    const res = await fetch(`${BASE}/render-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ shot }),
    });

    if (!res.ok) throw new Error(`Server ${res.status}`);

    const data = await res.json();
    renderQueue = data.queue || [];
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
    renderQueue = data.queue || [];
    renderRenderQueue();
  } catch (e) {
    console.error(e);
  }
}

async function clearRenderQueue() {
  try {
    const res = await fetch(`${BASE}/render-queue/clear`, {
      method: "POST",
    });

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

  count.textContent = `${renderQueue.length} Jobs`;

  if (!renderQueue.length) {
    panel.innerHTML = `
      <p style="
        color:var(--text-dim);
        font-size:11px;
        letter-spacing:2px;
        text-transform:uppercase;
      ">
        Queue empty.
      </p>
    `;
    return;
  }

  panel.innerHTML = renderQueue.map((item) => {
    const shot = item.shot || {};

    return `
      <div style="
        border:1px solid rgba(201,168,76,.14);
        padding:10px 12px;
        border-radius:4px;
        background:rgba(255,255,255,.02);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      ">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span style="
            color:var(--gold);
            font-size:13px;
            letter-spacing:1px;
            font-weight:700;
          ">
            ${shot.shot_number || shot.scene || "UNKNOWN"}
          </span>

          <span style="
            color:var(--text-muted);
            font-size:11px;
          ">
            ${shot.shotDesc || shot.title || "Untitled Shot"}
          </span>
        </div>

        <div style="
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:8px;
        ">
          ${renderStatusControls(item)}
        </div>
      </div>
    `;
  }).join("");
}

async function updateRenderStatus(itemId, status) {
  try {
    const res = await fetch(`${BASE}/render-queue/${itemId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
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
      method: "DELETE"
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

function renderStatusControls(item) {
  const status = item.status || "pending";

  return `
    <div class="render-status-pill render-status-${status}">
      ${status}
    </div>

    <div class="render-actions">
      <button onclick="updateRenderStatus('${item.id}', 'rendering')">Start</button>
      <button onclick="updateRenderStatus('${item.id}', 'complete')">Complete</button>
      <button onclick="updateRenderStatus('${item.id}', 'failed')">Failed</button>
      <button onclick="deleteRenderQueueItem('${item.id}')">Delete</button>
    </div>
  `;
}

async function updateRenderStatus(itemId, status) {
  try {
    const res = await fetch(`http://localhost:8000/render-queue/${itemId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Status update failed");
      return;
    }

    if (typeof loadRenderQueue === "function") {
      loadRenderQueue();
    } else {
      location.reload();
    }
  } catch (err) {
    alert("Render status error: " + err.message);
  }
}

async function deleteRenderQueueItem(itemId) {
  try {
    const res = await fetch(`http://localhost:8000/render-queue/${itemId}`, {
      method: "DELETE"
    });

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Delete failed");
      return;
    }

    if (typeof loadRenderQueue === "function") {
      loadRenderQueue();
    } else {
      location.reload();
    }
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

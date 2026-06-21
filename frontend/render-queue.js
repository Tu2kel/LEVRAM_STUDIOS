async function addShotToRenderQueue(id) {
  try {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;

    const res = await levFetch(`${BASE}/render-queue`, {
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
    const res = await levFetch(`${BASE}/render-queue`);
    if (!res.ok) throw new Error(`Server ${res.status}`);
    const data = await res.json();

    renderQueue = data.queue || data.jobs || data.items || [];
    window.renderQueue = renderQueue;

  } catch (e) {
    console.error("RQ API failed:", e);
    renderQueue = [];
    window.renderQueue = [];
  }

  renderRenderQueue();
  window.refreshBattery?.();
}

async function clearRenderQueue() {
  try {
    const res = await levFetch(`${BASE}/render-queue/clear`, { method: "POST" });
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
    panel.innerHTML = `<div class="rq-empty">Queue empty — add shots from the Voice Lab or Timeline.</div>`;
    return;
  }

  panel.innerHTML = renderQueue.map((item) => {
    const shot   = item.shot || item || {};
    const status = item.status || "pending";

    const title = shot.shot_number || item.shot_number || shot.scene || shot.id || "UNKNOWN";
    const sub   = shot.shotDesc || shot.shot_description || item.shotDesc || item.shot_description || shot.title || "Untitled Shot";
    const char  = shot.character || item.character || shot.voice_character || "";
    const preset = shot.preset || item.preset || shot.voice_preset || "";

    const hasKeyframe = Boolean(item.renderOutputUrl);
    const hasVoice    = Boolean(item.voicePath);
    const hasClip     = Boolean(item.clipUrl);

    return `
    <div class="rq-job-card">
      <div>
        <div class="rq-job-title">${title}${char ? " · " + char : ""}${preset ? " · " + preset : ""}</div>
        <div class="rq-job-sub">${sub}</div>
        ${shot.dialogue ? `<div class="tl-dialogue" style="margin-top:8px;">"${String(shot.dialogue).slice(0, 100)}${String(shot.dialogue).length > 100 ? "…" : ""}"</div>` : ""}
        ${hasKeyframe ? `
          <img class="rq-thumb" src="${BASE}${item.renderOutputUrl}" alt="Keyframe"
               onclick="window.location.href='render-viewer.html?id=${item.id}'" title="Click to open render viewer" />
          <div class="rq-prompt">
            <strong>Prompt:</strong>
            ${item.promptUsed || "Not recorded"}
          </div>
        ` : ""}
        ${hasClip ? `
          <video src="${item.clipUrl?.startsWith('http') ? item.clipUrl : BASE + item.clipUrl}" controls
                 style="width:100%;max-height:140px;border-radius:4px;margin-top:10px;background:#000;grid-column:1/-1;"></video>
        ` : ""}
      </div>

      <div class="rq-job-right">
        <div class="render-status-pill render-status-${status}">${status.toUpperCase()}</div>
        <div class="render-actions">
          <button onclick="generateKeyframeForQueueItem('${item.id}')"
                  title="Generate keyframe image">
            ${hasKeyframe ? "Re-Keyframe" : "Keyframe"}
          </button>
          <select id="rq-model-${item.id}"
                  style="background:#1a1a1a;border:1px solid #333;color:#fff;font-size:11px;padding:3px 6px;border-radius:3px;width:100%;margin-bottom:4px;"
                  ${!hasKeyframe ? "disabled" : ""}>
            <option value="ws_wan22" selected>Wan 2.2 ⚡ WaveSpeed</option>
            <option value="ws_wan27">Wan 2.7 ⚡ latest</option>
            <option value="kling_26">Kling 2.6 Pro</option>
            <option value="kling_o1">Kling O1 dual-frame</option>
            <option value="runway_gen4_i2v">Runway Gen-4.5 ✦</option>
            <option value="runway_turbo">Runway Turbo ✦</option>
          </select>
          <button onclick="animateKeyframe('${item.id}')"
                  ${!hasKeyframe ? 'disabled title="Generate keyframe first"' : 'title="Animate keyframe"'}>
            Animate →
          </button>
          <button onclick="assembleShotVideo('${item.id}')"
                  ${!hasKeyframe || !hasVoice ? 'disabled title="Need keyframe + voice first"' : 'title="Assemble final shot clip"'}>
            Assemble Clip
          </button>
          <button onclick="updateRenderStatus('${item.id}', 'done')"
                  title="Mark this shot as complete">
            Mark Done
          </button>
          <button onclick="deleteRenderQueueItem('${item.id}')" style="color:#ff6b6b;border-color:rgba(255,100,100,0.3);">
            Delete
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}

async function startRenderQueueItem(itemId) {
  try {
    const res = await levFetch(`${BASE}/render-queue/${itemId}/start`, {
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
    const res = await levFetch(`${BASE}/render-queue/${itemId}/keyframe`, {
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
    const res = await levFetch(`${BASE}/render-queue/${itemId}/status`, {
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
    const res = await levFetch(`${BASE}/render-queue/${itemId}`, {
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
    const res = await levFetch(`${BASE}/video/assemble-shot`, {
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
    const res = await levFetch(`${BASE}/video/assemble-episode`, {
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

// ─── I2V: Animate keyframe from render queue ─────────────────
async function animateKeyframe(itemId) {
  const item = renderQueue.find(i => i.id === itemId);
  if (!item?.renderOutputUrl) {
    alert("Generate a keyframe for this shot first.");
    return;
  }

  const modelKey = document.getElementById(`rq-model-${itemId}`)?.value || "ws_wan22";
  const motionPrompt = "";

  const statusEl = document.getElementById("ep-status");
  if (statusEl) statusEl.textContent = `Submitted I2V job via ${modelKey} — polling…`;

  try {
    const res = await levFetch(`${BASE}/video/image-to-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: item.renderOutputUrl,
        prompt: motionPrompt,
        model: modelKey,
        duration: 5,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "I2V submit failed");

    levPollJob(data.job_id, BASE, {
      onRunning: (sec) => {
        if (statusEl) statusEl.textContent = `Animating via ${modelKey} — ${sec}s elapsed…`;
      },
      onComplete: async (result) => {
        const outUrl = result.outputUrl || result.videoUrl;
        const fullUrl = outUrl.startsWith("http") ? outUrl : BASE + outUrl;
        if (statusEl) {
          statusEl.innerHTML = `Video ready — <a href="${fullUrl}" download style="color:var(--gold);">Download ${outUrl.split("/").pop()}</a>`;
        }
        await loadRenderQueue();
      },
      onFailed: (err) => {
        if (statusEl) statusEl.textContent = "Animate failed: " + err;
      },
    });
  } catch (err) {
    alert("Animate error: " + err.message);
    if (statusEl) statusEl.textContent = "Animate failed: " + err.message;
  }
}

window.loadRenderQueue               = loadRenderQueue;
window.startRenderQueueItem          = startRenderQueueItem;
window.generateKeyframeForQueueItem  = generateKeyframeForQueueItem;
window.updateRenderStatus            = updateRenderStatus;
window.deleteRenderQueueItem         = deleteRenderQueueItem;
window.assembleShotVideo             = assembleShotVideo;
window.assembleEpisode               = assembleEpisode;
window.animateKeyframe               = animateKeyframe;

// ─── State ───────────────────────────────────────────────
let rawUrl = null;
let rawPath = null;
let fxUrl = null;
let fxPath = null;
let shots = [];
let selectedSceneId = null;
let renderQueue = [];
const BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

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
        <audio controls src="${url}" style="width:100%;margin-top:34px;"></audio>
      </div>`;
}

function getActiveFxPreset() {
  return document.querySelector("select.fx-preset").value;
}

// Preset → equalizer slider sync
const FX_PRESET_DEFAULTS = {
  villain: { pitch: 72,  bass: 75, reverb: 35, volume: 105 },
  deep:    { pitch: 68,  bass: 85, reverb: 10, volume: 100 },
  monster: { pitch: 62,  bass: 70, reverb: 55, volume: 112 },
  ghost:   { pitch: 95,  bass: 15, reverb: 80, volume: 90  },
  radio:   { pitch: 100, bass: 25, reverb: 0,  volume: 88  },
  clean:   { pitch: 100, bass: 50, reverb: 0,  volume: 100 },
};

function applyFxPreset(presetName) {
  const defaults = FX_PRESET_DEFAULTS[presetName];
  if (!defaults) return;
  const sel = document.querySelector("select.fx-preset");
  if (sel) sel.value = presetName;
  ["pitch", "bass", "reverb", "volume"].forEach(key => {
    const el = document.getElementById(`fx-${key}`);
    if (el) {
      el.value = defaults[key];
      if (el.nextElementSibling) el.nextElementSibling.textContent = defaults[key] + "%";
    }
  });
}
window.applyFxPreset = applyFxPreset;

document.querySelector("select.fx-preset")?.addEventListener("change", (e) => {
  applyFxPreset(e.target.value);
});

function getAssignedVoiceProfile() {
  return window.LEVRAM_ACTIVE_VOICE_PROFILE || "";
}

function getActiveCharacter() {
  const sel = document.getElementById("voice-char-select");
  return sel?.value || "Default";
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

// ─── Character dropdown ───────────────────────────────────
document.getElementById("voice-char-select")?.addEventListener("change", () => {
  metaChar.textContent = getActiveCharacter();
});

// ─── Load saved scenes from backend ───────────────────────
async function loadScenes() {
  try {
    const res = await levFetch(`${BASE}/scenes`);
    const data = await res.json();

    if (!data.success) {
      throw new Error("Failed to load scenes");
    }

    shots = data.scenes.map((s) => ({
      id: s.id || s.scene_number || Date.now(),
      shot_number: s.scene_number || s.id || "UNKNOWN",
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

    window.shots = shots;
    renderTimeline();
    window.refreshBattery?.();
  } catch (e) {
    console.error(e);
    renderTimeline();
    setStatus("Could not load saved scenes", true);
  }
}

// ─── Delete shot ─────────────────────────────────────────
window.deleteShot = async function (id) {
  try {
    const res = await levFetch(`${BASE}/scene/${id}`, {
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
  themeToggle.textContent = savedTheme === "ivory" ? "Dark Mode" : "Ivory Mode";

  themeToggle.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "dark";

    const next = current === "ivory" ? "dark" : "ivory";

    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("levram-theme", next);

    themeToggle.textContent = next === "ivory" ? "Dark Mode" : "Ivory Mode";
  });
}

// ─── Init ─────────────────────────────────────────────────
loadScenes();

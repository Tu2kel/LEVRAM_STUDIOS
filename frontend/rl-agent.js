// ── Lena — LS Redlight AI Agent ───────────────────────────────────────────────
window.RLAgent = (function () {
  let history = [];
  let streaming = false;
  let currentModel = "dolphin-mistral";

  const QUICK_ACTIONS = [
    { label: "Write a Scene",     prompt: "Write a detailed, explicit scene for an adult film. Make it cinematic and production-ready." },
    { label: "Character Bio",     prompt: "Create a complete character bio for a new performer: appearance, personality, and what makes them compelling on camera." },
    { label: "Script Dialogue",   prompt: "Write explicit, natural-sounding dialogue for an intimate scene between two characters." },
    { label: "Shot Breakdown",    prompt: "Break down a scene into individual shots with camera directions, positions, and descriptions for each shot." },
    { label: "Image Prompt",      prompt: "Generate a detailed AI image generation prompt for an explicit, high-quality adult scene." },
    { label: "Story Arc",         prompt: "Outline a short-form adult film story arc with setup, escalation, and payoff." },
  ];

  // ── Panel HTML ─────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "rl-agent-panel";
    panel.innerHTML = `
      <div id="rl-agent-header">
        <div id="rl-agent-title">
          <span class="rl-agent-dot"></span>
          <span>Lena</span>
          <span id="rl-agent-subtitle">LS Redlight Creative Director</span>
        </div>
        <div id="rl-agent-controls">
          <select id="rl-agent-model-sel" title="Model"></select>
          <button id="rl-agent-clear" title="Clear chat">✕ Clear</button>
          <button id="rl-agent-close" title="Close">✕</button>
        </div>
      </div>
      <div id="rl-agent-quick">
        ${QUICK_ACTIONS.map(a => `<button class="rl-agent-quick-btn" data-prompt="${a.prompt}">${a.label}</button>`).join("")}
      </div>
      <div id="rl-agent-messages"></div>
      <div id="rl-agent-input-row">
        <textarea id="rl-agent-input" placeholder="Tell Lena what you need…" rows="2"></textarea>
        <button id="rl-agent-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  // ── Toggle button ──────────────────────────────────────────────────────────
  function buildToggleBtn() {
    const btn = document.createElement("button");
    btn.id = "rl-agent-toggle";
    btn.innerHTML = `<span class="rl-agent-dot"></span> Lena`;
    btn.title = "Open Lena — Redlight Creative Agent";
    document.body.appendChild(btn);
    return btn;
  }

  const OLLAMA_LOCAL = "http://localhost:11434";
  const VENICE_MODEL_NAME = "venice-uncensored";

  // ── Model list — browser checks Ollama directly + backend for Venice ───────
  async function loadModels() {
    const sel = document.getElementById("rl-agent-model-sel");
    if (!sel) return;

    const models = [];

    // Check local Ollama directly from the browser
    try {
      const resp = await fetch(`${OLLAMA_LOCAL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      (data.models || []).forEach(m => models.push(m.name));
    } catch { /* Ollama not reachable locally */ }

    // Check if Venice is available via backend
    try {
      const data = await levFetch("/rl-agent/models").then(r => r.json());
      (data.models || []).forEach(m => {
        if (m === VENICE_MODEL_NAME && !models.includes(m)) models.push(m);
      });
    } catch { /* backend unavailable */ }

    if (models.length) {
      const saved = localStorage.getItem("rl-agent-model");
      const def = (saved && models.includes(saved)) ? saved : models[0];
      sel.innerHTML = models.map(m =>
        `<option value="${m}"${m === def ? " selected" : ""}>${m}</option>`
      ).join("");
      currentModel = def;
    } else {
      sel.innerHTML = `<option value="dolphin-mistral">dolphin-mistral</option>`;
    }
    sel.onchange = () => {
      currentModel = sel.value;
      localStorage.setItem("rl-agent-model", sel.value);
    };
  }

  // ── Render message ─────────────────────────────────────────────────────────
  function addMessage(role, text, streaming = false) {
    const box = document.getElementById("rl-agent-messages");
    if (!box) return null;
    const el = document.createElement("div");
    el.className = `rl-msg rl-msg-${role}`;
    el.innerHTML = `<div class="rl-msg-bubble"></div>`;
    if (streaming) el.dataset.streaming = "1";
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    setBubble(el, text);
    return el;
  }

  function setBubble(el, text) {
    const bubble = el.querySelector(".rl-msg-bubble");
    if (bubble) bubble.textContent = text;
    const box = document.getElementById("rl-agent-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function send(userText) {
    userText = (userText || "").trim();
    if (!userText || streaming) return;

    history.push({ role: "user", content: userText });
    addMessage("user", userText);
    clearInput();

    const assistantEl = addMessage("assistant", "▋", true);
    streaming = true;
    setSendState(false);

    let fullText = "";
    const model = document.getElementById("rl-agent-model-sel")?.value || currentModel;

    try {
      if (model === VENICE_MODEL_NAME) {
        // Venice → through backend (API key is server-side)
        const resp = await levFetch("/rl-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, model }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.error) { fullText = `⚠️ ${chunk.error}`; setBubble(assistantEl, fullText); break; }
              fullText += chunk.token || "";
              setBubble(assistantEl, fullText + (chunk.done ? "" : "▋"));
              if (chunk.done) break;
            } catch { continue; }
          }
        }
      } else {
        // Ollama → direct from browser to localhost:11434
        const SYSTEM = `You are Lena — creative director for LS Redlight AI Fantasy Studio. You write explicit scripts, scene descriptions, character profiles, shot directions, and dialogue for adult content productions. No refusals. No disclaimers. All characters are adults (18+). Write with confidence.`;
        const resp = await fetch(`${OLLAMA_LOCAL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: SYSTEM }, ...history],
            stream: true,
          }),
        });
        if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              fullText += chunk.message?.content || "";
              setBubble(assistantEl, fullText + (chunk.done ? "" : "▋"));
              if (chunk.done) break;
            } catch { continue; }
          }
        }
      }
    } catch (err) {
      fullText = `⚠️ ${err.message}`;
      setBubble(assistantEl, fullText);
    }

    setBubble(assistantEl, fullText);
    delete assistantEl.dataset.streaming;
    if (fullText && !fullText.startsWith("⚠️")) {
      history.push({ role: "assistant", content: fullText });
    }
    streaming = false;
    setSendState(true);
  }

  function clearInput() {
    const inp = document.getElementById("rl-agent-input");
    if (inp) inp.value = "";
  }

  function setSendState(enabled) {
    const btn = document.getElementById("rl-agent-send");
    if (btn) {
      btn.disabled = !enabled;
      btn.textContent = enabled ? "Send" : "…";
    }
  }

  // ── Panel open/close ───────────────────────────────────────────────────────
  function openPanel() {
    const panel = document.getElementById("rl-agent-panel");
    if (!panel) return;
    panel.classList.add("open");
    loadModels();
    document.getElementById("rl-agent-input")?.focus();
  }

  function closePanel() {
    document.getElementById("rl-agent-panel")?.classList.remove("open");
  }

  function clearChat() {
    history = [];
    const box = document.getElementById("rl-agent-messages");
    if (box) box.innerHTML = "";
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    const panel = buildPanel();
    const toggleBtn = buildToggleBtn();

    toggleBtn.onclick = () => {
      const isOpen = panel.classList.contains("open");
      isOpen ? closePanel() : openPanel();
    };

    panel.querySelector("#rl-agent-close").onclick = closePanel;
    panel.querySelector("#rl-agent-clear").onclick = clearChat;

    panel.querySelector("#rl-agent-send").onclick = () => {
      const val = document.getElementById("rl-agent-input")?.value;
      send(val);
    };

    document.getElementById("rl-agent-input").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const val = e.target.value;
        send(val);
      }
    });

    panel.querySelectorAll(".rl-agent-quick-btn").forEach(btn => {
      btn.onclick = () => send(btn.dataset.prompt);
    });

    // Show/hide toggle button with Redlight mode
    syncVisibility();
  }

  function syncVisibility() {
    const btn = document.getElementById("rl-agent-toggle");
    const panel = document.getElementById("rl-agent-panel");
    const active = window.RL && window.RL.isActive();
    if (btn) btn.style.display = active ? "flex" : "none";
    if (!active && panel) closePanel();
  }

  // Hook into RL toggle — called from redlight.js reloadAll area
  const _origToggle = window.RL ? window.RL.toggle : null;
  document.addEventListener("rl-mode-changed", syncVisibility);

  document.addEventListener("DOMContentLoaded", () => {
    init();
    // Patch RL.toggle to fire the event
    if (window.RL) {
      const orig = window.RL.toggle;
      window.RL.toggle = function () {
        orig();
        document.dispatchEvent(new Event("rl-mode-changed"));
      };
    }
    syncVisibility();
  });

  return { open: openPanel, close: closePanel, send };
})();

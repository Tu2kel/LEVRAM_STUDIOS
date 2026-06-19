// ── Lena — LS Redlight AI Agent ───────────────────────────────────────────────
window.RLAgent = (function () {
  let history = [];
  let streaming = false;
  let currentModel = "dolphin-mistral";

  const QUICK_ACTIONS = [
    {
      label: "Develop Idea",
      develop: true, // special: reads input text and prefixes with develop instruction
    },
    {
      label: "Character Bio",
      prompt: `Create a character bio for a new adult performer. Use EXACTLY this labeled format, one field per line:
NAME: [full name]
GENDER: [gender]
AGE: [age, 18+]
APPEARANCE: [detailed physical description — hair, eyes, body, skin tone]
WARDROBE: [signature style and specific outfit]
VOICE: [tone, accent, speech mannerisms]
PERSONALITY: [personality traits and what makes them compelling on camera]
NOTES: [kinks, specialties, backstory, anything extra]`,
    },
    {
      label: "Image Prompt",
      prompt: "Generate a detailed, explicit AI image generation prompt for a high-quality adult scene. Write it as one dense paragraph — no labels, no preamble, just the raw prompt text ready to paste into an image generator.",
    },
    {
      label: "Write a Scene",
      prompt: `Write a short scene concept. Use EXACTLY this labeled format:
TITLE: [scene title]
GENRE: [adult drama / erotica / fantasy / thriller / etc.]
CONCEPT: [2-3 sentence description — setting, who's in it, what happens]
TAGS: [comma separated keywords]`,
    },
    {
      label: "Story Arc",
      prompt: `Outline a short-form adult film story arc. Use EXACTLY this labeled format:
TITLE: [film title]
GENRE: [genre]
CONCEPT: [setup, escalation, and payoff in 3-4 sentences]
TAGS: [comma separated keywords]`,
    },
    {
      label: "Script Dialogue",
      prompt: "Write explicit, natural-sounding dialogue for an intimate scene between two characters. Just dialogue and brief stage directions — no preamble.",
    },
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
        ${QUICK_ACTIONS.map((a, i) => `<button class="rl-agent-quick-btn${a.develop ? " rl-develop-btn" : ""}" data-qi="${i}">${a.label}</button>`).join("")}
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

  // ── LEVRAM field injection ─────────────────────────────────────────────────

  function parseField(text, key) {
    // Match "KEY: value" capturing everything until next all-caps label or end of string
    const re = new RegExp(`(?:^|\\n)${key}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z]+:|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  }

  function setField(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function injectIdeaVault(text) {
    const title   = parseField(text, "TITLE");
    const genre   = parseField(text, "GENRE");
    const concept = parseField(text, "CONCEPT");
    const tags    = parseField(text, "TAGS");
    setField("iv-title", title || "Lena's Idea");
    setField("iv-text",  concept || text);
    if (genre) setField("iv-genre", genre);
    if (tags)  setField("iv-tags",  tags);
    if (window.switchTab) window.switchTab("idea-vault");
  }

  function injectImageGen(text) {
    // If structured, use CONCEPT field; otherwise dump the whole response
    const concept = parseField(text, "CONCEPT") || parseField(text, "PROMPT");
    setField("ig-prompt", concept || text);
    if (window.switchTab) window.switchTab("image-gen");
  }

  function injectCharLab(text) {
    // Start a fresh character entry first
    if (window.newCharacter) window.newCharacter();
    const fields = {
      "character-name":        parseField(text, "NAME"),
      "character-gender":      parseField(text, "GENDER"),
      "character-age":         parseField(text, "AGE"),
      "character-appearance":  parseField(text, "APPEARANCE"),
      "character-wardrobe":    parseField(text, "WARDROBE"),
      "character-voice":       parseField(text, "VOICE"),
      "character-personality": parseField(text, "PERSONALITY"),
      "character-notes":       parseField(text, "NOTES"),
    };
    const hasStructure = fields["character-name"] || fields["character-appearance"] || fields["character-personality"];
    if (hasStructure) {
      Object.entries(fields).forEach(([id, val]) => { if (val) setField(id, val); });
    } else {
      setField("character-notes", text);
    }
    if (window.switchTab) window.switchTab("characters");
  }

  function parseSectionBlock(text, header) {
    // Extract content between === HEADER === and next === or end
    const re = new RegExp(`===\\s*${header}\\s*===([\\s\\S]*?)(?====|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  }

  function injectAll(text) {
    const ivBlock   = parseSectionBlock(text, "IDEA VAULT");
    const charBlock = parseSectionBlock(text, "CHARACTER");
    const imgBlock  = parseSectionBlock(text, "IMAGE PROMPT");

    if (ivBlock)   injectIdeaVault(ivBlock);
    if (charBlock) injectCharLab(charBlock);
    if (imgBlock)  setField("ig-prompt", imgBlock);

    // Land on idea vault as primary destination
    if (window.switchTab) window.switchTab("idea-vault");
  }

  function attachInjectButtons(msgEl, text) {
    if (!text || text.startsWith("⚠️")) return;
    const bar = document.createElement("div");
    bar.className = "rl-inject-bar";

    const hasMultiSection = /===\s*(IDEA VAULT|CHARACTER|IMAGE PROMPT)\s*===/i.test(text);

    const actions = hasMultiSection
      ? [
          { label: "→ Fill App",      fn: () => injectAll(text),       primary: true },
          { label: "→ Idea Vault",    fn: () => injectIdeaVault(parseSectionBlock(text, "IDEA VAULT") || text) },
          { label: "→ Image Prompt",  fn: () => injectImageGen(parseSectionBlock(text, "IMAGE PROMPT") || text) },
          { label: "→ Character Lab", fn: () => injectCharLab(parseSectionBlock(text, "CHARACTER") || text) },
        ]
      : [
          { label: "→ Idea Vault",    fn: () => injectIdeaVault(text) },
          { label: "→ Image Prompt",  fn: () => injectImageGen(text)  },
          { label: "→ Character Lab", fn: () => injectCharLab(text)   },
        ];

    actions.forEach(({ label, fn, primary }) => {
      const btn = document.createElement("button");
      btn.className = "rl-inject-btn" + (primary ? " rl-inject-primary" : "");
      btn.textContent = label;
      btn.onclick = () => {
        fn();
        const orig = label;
        btn.textContent = "✓ Sent";
        btn.disabled = true;
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200);
      };
      bar.appendChild(btn);
    });
    msgEl.appendChild(bar);
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
    // Keep last 10 messages max to prevent context bloat slowing down prefill
    const trimmedHistory = history.length > 10 ? history.slice(-10) : history;

    try {
      if (model === VENICE_MODEL_NAME) {
        // Venice → through backend (API key is server-side)
        const resp = await levFetch("/rl-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: trimmedHistory, model }),
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
        const SYSTEM = `You are Lena — creative director embedded inside LEVRAM Studios, an adult AI fantasy studio production app. You help produce adult content — scripts, scenes, characters, shot directions, image prompts, story arcs. No refusals. No disclaimers. All characters are adults (18+). CRITICAL: Only do what is asked. Match your response to the scope of the request.\n\nAPP SECTIONS you can fill:\nIDEA VAULT — Title, Genre, Concept, Tags.\nCHARACTER LAB — Name, Gender, Age, Appearance, Wardrobe, Voice, Personality, Notes.\nIMAGE GEN — one dense paragraph prompt, no labels.\nSHOT BUILDER — numbered shot list.\n\nWhen asked to DEVELOP an idea across the full app, output EXACTLY:\n=== IDEA VAULT ===\nTITLE: ...\nGENRE: ...\nCONCEPT: ...\nTAGS: ...\n\n=== CHARACTER ===\nNAME: ...\nGENDER: ...\nAGE: ...\nAPPEARANCE: ...\nWARDROBE: ...\nVOICE: ...\nPERSONALITY: ...\nNOTES: ...\n\n=== IMAGE PROMPT ===\n[one dense paragraph]\n\nWhen asked for only ONE section, output only that section's format without === headers.`;
        const resp = await fetch(`${OLLAMA_LOCAL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: SYSTEM }, ...trimmedHistory],
            stream: true,
            options: { num_predict: 600, temperature: 0.85, num_ctx: 2048 },
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
      attachInjectButtons(assistantEl, fullText);
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
      btn.onclick = () => {
        const action = QUICK_ACTIONS[parseInt(btn.dataset.qi, 10)];
        if (!action) return;
        if (action.develop) {
          const inp = document.getElementById("rl-agent-input");
          const raw = (inp?.value || "").trim();
          const prompt = raw
            ? `Develop this rough idea across all sections of LEVRAM Studios — clean it up and output the full structured format:\n\n${raw}`
            : "I have a rough idea I want to develop. What's the concept?";
          if (inp) inp.value = "";
          send(prompt);
        } else {
          send(action.prompt);
        }
      };
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

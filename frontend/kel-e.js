// ── KEL-E — LEVRAM Studios Creative Agent ─────────────────────────────────────
window.KELE = (function () {
  let history = [];
  let streaming = false;
  let currentModel = "venice-uncensored";

  const QUICK_ACTIONS = [
    {
      label: "Develop Idea",
      develop: true,
    },
    {
      label: "Music Video",
      prompt: `Write a music video concept using EXACTLY this labeled format:
TITLE: [video title]
GENRE: [genre / style]
CONCEPT: [2-3 sentence visual concept — setting, mood, what happens shot to shot]
TAGS: [comma separated keywords]`,
    },
    {
      label: "Character Bio",
      prompt: `Create a character bio. Use EXACTLY this labeled format:
NAME: [full name]
GENDER: [gender]
AGE: [age]
APPEARANCE: [physical description — build, hair, eyes, distinguishing features]
WARDROBE: [signature style and specific look]
VOICE: [tone, accent, speech mannerisms]
PERSONALITY: [attitude, energy, how they carry themselves]
NOTES: [backstory, motivations, anything extra]`,
    },
    {
      label: "Short Film",
      prompt: `Write a short film concept using EXACTLY this labeled format:
TITLE: [film title]
GENRE: [genre]
CONCEPT: [setup, conflict, and resolution in 3-4 sentences]
TAGS: [comma separated keywords]`,
    },
    {
      label: "Shot List",
      prompt: "Write a numbered shot list for a scene. For each shot: number, camera angle, subject, action, and mood. Be specific and cinematic.",
    },
    {
      label: "Dialogue",
      prompt: "Write sharp, natural dialogue for a scene between two characters. Just the lines and brief stage directions — no preamble.",
    },
  ];

  const KELE_API = "/kel-e/chat";

  const SYSTEM = `You are KEL-E — creative director for LEVRAM Studios, a professional music video and short film production studio.

You help develop music videos, skits, short films, story arcs, character bios, shot lists, dialogue, and production concepts. Your output is always sharp, cinematic, and production-ready.

CRITICAL: Only do what is asked. Match your response exactly to the scope of the request.

CREATIVE DIRECTION — ENFORCE THESE WITHOUT EXCEPTION:
- Honor the user's ending. If they say the character is standing in blood, she is standing in blood. Do NOT redirect to hope, healing, or reclaimed power unless the user specifically asked for that.
- Dark endings are valid endings. Tragedy, moral ambiguity, unresolved trauma, and villain-adjacent outcomes are legitimate story conclusions. Do not add redemption arcs the user did not write.
- Traumatic bonding, Stockholm dynamics, fractured psychology, and emotional contradiction (e.g. killing someone you were attached to) are powerful storytelling tools. Develop them, don't sanitize them.
- If the user's character becomes "slightly evil," more aggressive, hypervigilant, or emotionally unstable — write that character exactly as described. Do not soften it into a "journey to healing."
- The user's tone is the correct tone. Match darkness with darkness, complexity with complexity. Do not impose a network-TV filter on noir, psychological thriller, or adult drama concepts.
- Never add "renewed spirit," "newfound purpose," or "ready to continue her journey" endings unless the user wrote those words. Assume the ending is what the user told you it is.

APP SECTIONS you can fill:
IDEA VAULT — Title, Genre, Concept (the full idea/summary), Tags (keywords), Location (primary shooting location name if relevant).
CHARACTER LAB — Name, Gender, Age, Appearance (physical detail), Wardrobe (style + outfit), Voice (tone/speech), Personality (attitude and energy), Notes (backstory, motivations).
IMAGE GEN — one dense paragraph visual prompt, no labels, ready for an AI image generator.
SHOT BUILDER — numbered shot list with camera angle, subject, action, and mood for each shot.

When asked to DEVELOP an idea across the full app, output EXACTLY this multi-section format:

=== IDEA VAULT ===
TITLE: ...
GENRE: ...
CONCEPT: ...
TAGS: ...
LOCATION: [primary location name if relevant, or leave blank]

=== CHARACTER ===
NAME: ...
GENDER: ...
AGE: ...
APPEARANCE: ...
WARDROBE: ...
VOICE: ...
PERSONALITY: ...
NOTES: ...

=== IMAGE PROMPT ===
[one dense paragraph — lighting, setting, composition, mood, style]

When asked for a shot list, output EXACTLY this format:
=== SHOT BUILDER ===
[numbered shots]

When asked for only ONE section, output only that section's format without === headers.`;

  // ── Panel HTML ─────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "kele-panel";
    panel.innerHTML = `
      <div id="kele-header">
        <div id="kele-title">
          <span class="kele-dot"></span>
          <span>KEL-E</span>
          <span id="kele-subtitle">LEVRAM Creative Director</span>
        </div>
        <div id="kele-controls">
          <select id="kele-model-sel" title="Model"></select>
          <button id="kele-clear" title="Clear chat">✕ Clear</button>
          <button id="kele-close" title="Close">✕</button>
        </div>
      </div>
      <div id="kele-quick">
        ${QUICK_ACTIONS.map((a, i) => `<button class="kele-quick-btn${a.develop ? " kele-develop-btn" : ""}" data-qi="${i}">${a.label}</button>`).join("")}
      </div>
      <div id="kele-messages"></div>
      <div id="kele-input-row">
        <textarea id="kele-input" placeholder="Tell KEL-E what you're working on…" rows="2"></textarea>
        <button id="kele-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function buildToggleBtn() {
    const btn = document.createElement("button");
    btn.id = "kele-toggle";
    btn.innerHTML = `<span class="kele-dot"></span> KEL-E`;
    btn.title = "Open KEL-E — LEVRAM Creative Agent";
    document.body.appendChild(btn);
    return btn;
  }

  // ── Model loader ───────────────────────────────────────────────────────────
  async function loadModels() {
    const sel = document.getElementById("kele-model-sel");
    if (!sel) return;
    sel.innerHTML = `
      <option value="hermes-3-llama-3.1-405b" selected>Hermes 3 405B</option>
      <option value="llama-3.3-70b">Llama 3.3 70B</option>
      <option value="deepseek-v3.2">DeepSeek V3.2</option>
      <option value="gemma-4-uncensored">Gemma 4 Uncensored</option>
    `;
    currentModel = "hermes-3-llama-3.1-405b";
    sel.onchange = () => { currentModel = sel.value; };
  }

  // ── Message rendering ──────────────────────────────────────────────────────
  function addMessage(role, text, isStreaming = false) {
    const box = document.getElementById("kele-messages");
    if (!box) return null;
    const el = document.createElement("div");
    el.className = `kele-msg kele-msg-${role}`;
    el.innerHTML = `<div class="kele-msg-bubble"></div>`;
    if (isStreaming) el.dataset.streaming = "1";
    box.appendChild(el);
    setBubble(el, text);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function setBubble(el, text) {
    const bubble = el.querySelector(".kele-msg-bubble");
    if (bubble) bubble.textContent = text;
    const box = document.getElementById("kele-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  // ── LEVRAM field injection ─────────────────────────────────────────────────
  function parseField(text, key) {
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

  function parseSectionBlock(text, header) {
    const re = new RegExp(`===\\s*${header}\\s*===([\\s\\S]*?)(?====|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  }

  function injectIdeaVault(text) {
    const title    = parseField(text, "TITLE");
    const genre    = parseField(text, "GENRE");
    const concept  = parseField(text, "CONCEPT");
    const tags     = parseField(text, "TAGS");
    const location = parseField(text, "LOCATION");
    setField("iv-title", title || "KEL-E Idea");
    setField("iv-text",  concept || text);
    if (genre) setField("iv-genre", genre);
    if (tags)  setField("iv-tags",  tags);
    if (location) {
      const locSel = document.getElementById("iv-dev-location");
      if (locSel) {
        const loc = location.toLowerCase().trim();
        const opt = [...locSel.options].find(o =>
          o.value.toLowerCase() === loc || o.textContent.trim().toLowerCase() === loc
        );
        if (opt) locSel.value = opt.value;
      }
    }
    if (window.switchTab) window.switchTab("idea-vault");
  }

  function injectShotBuilder(text) {
    const shotEl = document.getElementById("ai-shot-idea");
    if (shotEl) {
      shotEl.value = text;
      shotEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (window.switchTab) window.switchTab("shot-builder");
    const sbTab = document.querySelector(".nav-btn[data-tab='shot-builder']");
    if (sbTab) sbTab.click();
  }

  function injectImageGen(text) {
    const concept = parseField(text, "CONCEPT") || parseField(text, "PROMPT");
    setField("ig-prompt", concept || text);
    if (window.switchTab) window.switchTab("image-gen");
  }

  async function injectCharLab(text) {
    if (window.newCharacter) window.newCharacter();
    const name = parseField(text, "NAME");
    const fields = {
      "character-name":        name,
      "character-gender":      parseField(text, "GENDER"),
      "character-age":         parseField(text, "AGE"),
      "character-appearance":  parseField(text, "APPEARANCE"),
      "character-wardrobe":    parseField(text, "WARDROBE"),
      "character-voice":       parseField(text, "VOICE"),
      "character-personality": parseField(text, "PERSONALITY"),
      "character-notes":       parseField(text, "NOTES"),
    };
    const hasStructure = name || fields["character-appearance"] || fields["character-personality"];
    if (hasStructure) {
      Object.entries(fields).forEach(([id, val]) => { if (val) setField(id, val); });
    } else {
      setField("character-notes", text);
    }
    if (window.switchTab) window.switchTab("characters");
    if (window.saveCharacter) {
      await window.saveCharacter();
      // Reload IG character dropdown and auto-select the saved character
      if (window.igLoadCharacters) {
        await window.igLoadCharacters();
        if (name) {
          const sel = document.getElementById("ig-character");
          if (sel) {
            const opt = [...sel.options].find(o =>
              (o.dataset.name || "").toLowerCase() === name.toLowerCase() ||
              o.textContent.trim().toLowerCase().startsWith(name.toLowerCase())
            );
            if (opt) sel.value = opt.value;
          }
        }
      }
    }
  }

  async function injectAll(text) {
    const ivBlock   = parseSectionBlock(text, "IDEA VAULT");
    const charBlock = parseSectionBlock(text, "CHARACTER");
    const imgBlock  = parseSectionBlock(text, "IMAGE PROMPT");
    if (ivBlock)   injectIdeaVault(ivBlock);  // already calls switchTab("idea-vault")
    if (charBlock) await injectCharLab(charBlock);  // await so IG dropdown refreshes after save
    if (imgBlock)  setField("ig-prompt", imgBlock);
    // Only switch if injectIdeaVault didn't already — avoids double ivLoadCharacters race
    if (!ivBlock && window.switchTab) window.switchTab("idea-vault");
  }

  function attachInjectButtons(msgEl, text) {
    if (!text || text.startsWith("⚠️")) return;
    const bar = document.createElement("div");
    bar.className = "kele-inject-bar";

    const hasShotBuilder  = /===\s*SHOT BUILDER\s*===/i.test(text);
    const hasMultiSection = /===\s*(IDEA VAULT|CHARACTER|IMAGE PROMPT)\s*===/i.test(text);

    let actions;
    if (hasShotBuilder && !hasMultiSection) {
      const shotBlock = parseSectionBlock(text, "SHOT BUILDER") || text;
      actions = [
        { label: "→ Shot Builder", fn: () => injectShotBuilder(shotBlock), primary: true },
      ];
    } else if (hasMultiSection) {
      actions = [
        { label: "→ Fill App",      fn: () => injectAll(text), primary: true },
        { label: "→ Idea Vault",    fn: () => injectIdeaVault(parseSectionBlock(text, "IDEA VAULT") || text) },
        { label: "→ Image Prompt",  fn: () => injectImageGen(parseSectionBlock(text, "IMAGE PROMPT") || text) },
        { label: "→ Character Lab", fn: () => injectCharLab(parseSectionBlock(text, "CHARACTER") || text) },
      ];
      if (hasShotBuilder) {
        actions.push({ label: "→ Shot Builder", fn: () => injectShotBuilder(parseSectionBlock(text, "SHOT BUILDER") || text) });
      }
    } else {
      actions = [
        { label: "→ Idea Vault",    fn: () => injectIdeaVault(text) },
        { label: "→ Image Prompt",  fn: () => injectImageGen(text)  },
        { label: "→ Character Lab", fn: () => injectCharLab(text)   },
      ];
    }

    actions.forEach(({ label, fn, primary }) => {
      const btn = document.createElement("button");
      btn.className = "kele-inject-btn" + (primary ? " kele-inject-primary" : "");
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

  // ── Send ───────────────────────────────────────────────────────────────────
  async function send(userText) {
    userText = (userText || "").trim();
    if (!userText || streaming) return;

    history.push({ role: "user", content: userText });
    addMessage("user", userText);
    const inp = document.getElementById("kele-input");
    if (inp) inp.value = "";

    const assistantEl = addMessage("assistant", "▋", true);
    streaming = true;
    setSendState(false);

    let fullText = "";
    const model = document.getElementById("kele-model-sel")?.value || currentModel;
    const trimmedHistory = history.length > 10 ? history.slice(-10) : history;

    try {
      const resp = await fetch(KELE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: trimmedHistory, model: currentModel }),
      });
      if (!resp.ok) throw new Error(`KEL-E API ${resp.status}`);
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            if (chunk.error) { fullText = `⚠️ ${chunk.error}`; setBubble(assistantEl, fullText); break; }
            fullText += chunk.token || "";
            setBubble(assistantEl, fullText + (chunk.done ? "" : "▋"));
          } catch { continue; }
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

  function setSendState(enabled) {
    const btn = document.getElementById("kele-send");
    if (btn) { btn.disabled = !enabled; btn.textContent = enabled ? "Send" : "…"; }
  }

  // ── Panel open/close ───────────────────────────────────────────────────────
  function openPanel() {
    const panel = document.getElementById("kele-panel");
    if (!panel) return;
    panel.classList.add("open");
    loadModels();
    document.getElementById("kele-input")?.focus();
  }

  function closePanel() {
    document.getElementById("kele-panel")?.classList.remove("open");
  }

  function clearChat() {
    history = [];
    const box = document.getElementById("kele-messages");
    if (box) box.innerHTML = "";
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    const panel     = buildPanel();
    const toggleBtn = buildToggleBtn();

    toggleBtn.onclick = () => {
      panel.classList.contains("open") ? closePanel() : openPanel();
    };

    panel.querySelector("#kele-close").onclick = closePanel;
    panel.querySelector("#kele-clear").onclick  = clearChat;

    panel.querySelector("#kele-send").onclick = () => {
      send(document.getElementById("kele-input")?.value);
    };

    document.getElementById("kele-input").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(e.target.value);
      }
    });

    panel.querySelectorAll(".kele-quick-btn").forEach(btn => {
      btn.onclick = () => {
        const action = QUICK_ACTIONS[parseInt(btn.dataset.qi, 10)];
        if (!action) return;
        if (action.develop) {
          const inp = document.getElementById("kele-input");
          const raw = (inp?.value || "").trim();
          if (!raw) {
            const msgEl = addMessage("assistant", "Type your idea in the input field below, then click Develop Idea. Give me the concept — genre, characters, vibe, anything — and I'll build it out across all sections.");
            attachInjectButtons(msgEl, "");
            return;
          }
          const prompt = `Develop this idea across all sections of LEVRAM Studios — clean it up and output the full structured format:\n\n${raw}`;
          if (inp) inp.value = "";
          send(prompt);
        } else {
          send(action.prompt);
        }
      };
    });
  }

  document.addEventListener("DOMContentLoaded", () => { init(); });

  return { open: openPanel, close: closePanel, send };
})();

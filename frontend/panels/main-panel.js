document.getElementById("tab-main").innerHTML = `
  <!-- LEFT — Voice Lab -->
  <div class="left-panel">
    <div class="panel-header">
      <div class="panel-header-icon red">
        <svg viewBox="0 0 16 16">
          <path d="M8 1a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M3 9a5 5 0 0 0 10 0" />
        </svg>
      </div>
      <span class="panel-title">Voice Lab</span>
      <span class="panel-badge">Live</span>
    </div>
    <div class="voice-lab">
      <div class="field-group">
        <div class="field-label">Script / Line</div>
        <textarea id="script-input" class="script-input" placeholder="Enter dialogue or leave blank for silent shot..."></textarea>
      </div>
      <div class="field-group">
        <div class="field-label">Character</div>
        <select id="voice-char-select" class="voice-char-select">
          <option value="">Loading characters...</option>
        </select>
        <div id="voice-char-badge" class="voice-char-badge" style="display:none;"></div>
      </div>
      <div class="gold-divider"></div>
      <div class="field-group">
        <div class="field-label">Voice FX Preset</div>
        <select class="fx-preset">
          <option value="villain">Villain — Dark &amp; Reverbed</option>
          <option value="deep">Deep — Pure Bass Shift</option>
          <option value="monster">Monster — Chorus + Growl</option>
          <option value="ghost">Ghost — Echo Chamber</option>
          <option value="radio">Radio — Lo-Fi Filter</option>
          <option value="clean">Clean — No FX</option>
        </select>
      </div>
      <div class="field-group">
        <div class="field-label">Equalizer</div>
        <div class="fx-grid">
          <div class="slider-row">
            <span class="slider-name">Pitch</span>
            <input type="range" id="fx-pitch" min="50" max="150" value="72" oninput="this.nextElementSibling.textContent = this.value + '%'" />
            <span class="slider-val">72%</span>
          </div>
          <div class="slider-row">
            <span class="slider-name">Bass</span>
            <input type="range" id="fx-bass" min="0" max="100" value="75" oninput="this.nextElementSibling.textContent = this.value + '%'" />
            <span class="slider-val">75%</span>
          </div>
          <div class="slider-row">
            <span class="slider-name">Reverb</span>
            <input type="range" id="fx-reverb" min="0" max="100" value="35" oninput="this.nextElementSibling.textContent = this.value + '%'" />
            <span class="slider-val">35%</span>
          </div>
          <div class="slider-row">
            <span class="slider-name">Volume</span>
            <input type="range" id="fx-volume" min="50" max="150" value="105" oninput="this.nextElementSibling.textContent = this.value + '%'" />
            <span class="slider-val">105%</span>
          </div>
        </div>
      </div>
      <button id="btn-fx" class="gen-btn" style="background:linear-gradient(90deg,#1f4fa3,#2e6fd4,#1f4fa3);margin-bottom:8px;font-size:22px;letter-spacing:4px;">Apply Voice FX</button>
      <button id="btn-generate" class="gen-btn">Generate Voice</button>
      <button id="btn-attach-voice" class="gen-btn" style="display:none;background:linear-gradient(90deg,rgba(201,168,76,0.15),rgba(201,168,76,0.08));border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-size:18px;letter-spacing:3px;margin-top:6px;">Attach to Active Shot</button>
      <p id="status-text" class="status">Ready</p>
    </div>
  </div>

  <!-- RIGHT — Shot Builder -->
  <div class="right-panel">
    <div class="panel-header">
      <div class="panel-header-icon blue">
        <svg viewBox="0 0 16 16" fill="white">
          <path d="M1 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4zm5 4l4-2.5v5L6 8z" />
        </svg>
      </div>
      <span class="panel-title">Shot Builder</span>
    </div>
    <div class="shot-builder">
      <div class="shot-grid">
        <div class="shot-field" style="grid-column:1/-1">
          <div class="field-label">AI Shot Idea</div>
          <textarea id="ai-shot-idea" placeholder="Give LEVRAM a rough idea..." style="height:54px;resize:none"></textarea>
        </div>
        <div class="shot-field" style="grid-column:1/-1">
          <div class="field-label">Director Notes</div>
          <textarea id="ai-override-notes" placeholder="Director notes: make camera closer, add rain, remove city, make darker..." style="height:54px;resize:none"></textarea>
        </div>
        <div class="shot-field">
          <div class="field-label">Project</div>
          <select id="shot-project" onchange="igToggleCustomProject(this)">
            <option value="">— Select Project —</option>
            <option>Kelz Saga</option>
            <option>Hulk Saga</option>
            <option>Flash Saga</option>
            <option>Batman Saga</option>
            <option>Alpha Centurium</option>
            <option>Hero Fallout</option>
            <option>Chicago Skit</option>
            <option>Custom</option>
          </select>
          <input id="shot-project-custom" type="text" placeholder="Project name…" style="display:none;margin-top:4px;width:100%;box-sizing:border-box;" />
        </div>
        <div class="shot-field">
          <div class="field-label">Scene #</div>
          <input id="shot-scene" type="text" placeholder="020" />
        </div>
        <div class="shot-field">
          <div class="field-label">Shot Type</div>
          <select id="shot-type">
            <option selected>AI Suggested</option>
            <option>Extreme Close-Up</option>
            <option>Close-Up</option>
            <option>Medium Shot</option>
            <option>Wide Shot</option>
            <option>Bird's Eye</option>
            <option>Ground Level</option>
            <option>Tracking Shot</option>
            <option>Over-the-Shoulder</option>
            <option>Manual Override</option>
          </select>
        </div>
        <div class="shot-field">
          <div class="field-label">Primary Character</div>
          <select id="shot-character">
            <option value="">None</option>
          </select>
        </div>
        <div class="shot-field">
          <div class="field-label">Secondary Character</div>
          <select id="shot-character-secondary">
            <option value="">None</option>
          </select>
        </div>
        <div id="shot-character-panel" style="display:none;grid-column:1/-1;"></div>
        <div class="shot-field">
          <div class="field-label">Camera Mood</div>
          <select id="shot-camera">
            <option selected>AI Suggested</option>
            <option>Manual Override</option>
            <option>Slow / Heavy / Suffocating</option>
            <option>Violently Disorienting</option>
            <option>Dreamlike / Still / Vast</option>
            <option>Intimate / Invasive</option>
            <option>Civilian POV</option>
          </select>
        </div>
        <div class="shot-field">
          <div class="field-label">Color Palette</div>
          <select id="shot-palette">
            <option selected>AI Suggested</option>
            <option>Manual Override</option>
            <option>Cold Blue-White (Runner)</option>
            <option>Amber Dying to Ash (Other Side)</option>
            <option>Bio-Green + Supernova Red (Banner)</option>
            <option>Dark Neon / Rain</option>
            <option>Custom</option>
          </select>
        </div>
        <div class="shot-field" style="grid-column:1/-1">
          <div class="field-label">Shot Description</div>
          <textarea id="shot-desc" placeholder="What physically happens in this shot..." style="height:60px;resize:none"></textarea>
        </div>
        <div class="shot-field shot-prompt">
          <div class="field-label">Shot Prompt</div>
          <textarea id="shot-prompt-input" placeholder="Describe the shot — atmosphere, subject, lighting, emotion."></textarea>
        </div>
        <div class="shot-field" style="grid-column:1/3">
          <div class="field-label">Visual Character</div>
          <input id="shot-char-override" type="text" placeholder="Who is visible? Leave blank to use Voice Lab character..." />
          <div class="field-hint">Voice Lab controls who speaks. Visual Character controls who appears on screen.</div>
        </div>
        <div class="shot-field">
          <div class="field-label">Duration</div>
          <select id="shot-duration">
            <option>2s</option>
            <option selected>4s</option>
            <option>8s</option>
            <option>16s</option>
          </select>
        </div>
        <div class="shot-field">
          <div class="field-label">AI Engine</div>
          <select id="shot-engine">
            <option value="gpt-4o">GPT-4o (OpenAI)</option>
            <option value="claude-sonnet">Claude Sonnet</option>
            <option value="claude-opus">Claude Opus</option>
            <option value="ollama">Ollama (Local)</option>
          </select>
        </div>
      </div>
      <button id="btn-ai-build-shot" class="build-shot-btn">AI Build Shot</button>
      <button id="btn-ai-revise-shot" class="build-shot-btn">AI Revise Shot</button>
      <button id="btn-generate-prompt" class="build-shot-btn">Generate Prompt</button>
      <button id="btn-save-shot" class="build-shot-btn">Save Shot Card</button>
      <div style="border-top:1px solid rgba(201,168,76,0.15);margin:10px 0 8px;"></div>
      <button id="btn-send-to-queue" class="build-shot-btn" style="background:linear-gradient(90deg,rgba(201,168,76,0.12),rgba(201,168,76,0.06));border-color:rgba(201,168,76,0.4);color:var(--gold);">Send to Render Queue</button>
      <button id="btn-shot-keyframe" class="build-shot-btn" style="border-color:rgba(60,120,255,0.4);color:var(--blue-bright);">Generate Keyframe →</button>
      <button id="btn-shot-wan-video" class="build-shot-btn" style="border-color:rgba(60,180,80,0.4);color:#4caf50;">Generate Wan Video →</button>
    </div>
  </div>
`;

window.igToggleCustomProject = function(sel) {
  const inp = document.getElementById("shot-project-custom");
  if (!inp) return;
  if (sel.value === "Custom") {
    inp.style.display = "block";
    inp.focus();
  } else {
    inp.style.display = "none";
    inp.value = "";
  }
};

document.getElementById("tab-image-gen").innerHTML = `
  <!-- LEFT — Generation controls -->
  <div class="left-panel" style="flex:0 0 360px;overflow-y:auto;">
    <div class="panel-header">
      <div class="panel-header-icon gold">
        <svg viewBox="0 0 16 16" fill="black"><rect x="1" y="1" width="14" height="14" rx="1"/><circle cx="5" cy="5" r="1.5"/><path d="M1 11l4-4 3 3 2-2 5 5"/></svg>
      </div>
      <span class="panel-title">Image Gen</span>
      <span class="panel-badge">Phase 9</span>
    </div>
    <div class="voice-lab">

      <!-- AUTO-CREATE SCENE -->
      <div id="orch-panel" style="background:rgba(201,168,76,0.05);border:1px solid rgba(201,168,76,0.25);border-radius:4px;padding:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" onclick="document.getElementById('orch-body').style.display=document.getElementById('orch-body').style.display==='none'?'flex':'none'">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);">&#9889; Auto-Create Scene</span>
          <span style="font-size:10px;color:var(--text-dim);">&#9662;</span>
        </div>
        <div id="orch-body" style="display:none;flex-direction:column;gap:8px;margin-top:10px;">
          <textarea id="orch-concept" rows="3" placeholder="Scene concept — e.g. Kelz stands on the megastructure, turns to face the Dyson sphere, then leaps into the void"
                    style="background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:6px 8px;border-radius:2px;resize:vertical;width:100%;box-sizing:border-box;"></textarea>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div>
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">Character</div>
              <select id="orch-character" style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 6px;border-radius:2px;" data-char-sync
                onchange="LEVRAM_CHAR.set(this.value, this.selectedOptions[0]?.textContent)">
                <option value="">None / Standalone</option>
              </select>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">Shots</div>
              <select id="orch-shots" style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 6px;border-radius:2px;">
                <option value="2">2 shots</option>
                <option value="3" selected>3 shots</option>
                <option value="4">4 shots</option>
                <option value="5">5 shots</option>
              </select>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">Duration</div>
              <select id="orch-duration" style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 6px;border-radius:2px;">
                <option value="3">3s per clip</option>
                <option value="5" selected>5s per clip</option>
              </select>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px;">Video Model</div>
              <select id="orch-model" style="width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 6px;border-radius:2px;">
                <option value="ws_wan22" selected>Wan 2.2 &#9889; — $0.05/clip (WaveSpeed)</option>
                <option value="ws_wan27">Wan 2.7 &#9889; — latest (WaveSpeed)</option>
                <option value="kling_26">Kling 2.6 Pro — production</option>
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;cursor:pointer;">
            <input type="checkbox" id="orch-tts" style="accent-color:var(--gold);" />
            Generate voice lines
          </label>
          <button onclick="orchRun()" id="orch-run-btn"
                  style="width:100%;background:linear-gradient(90deg,rgba(139,105,20,0.5),rgba(201,168,76,0.5));border:1px solid rgba(201,168,76,0.6);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;padding:8px;border-radius:3px;cursor:pointer;">
            &#9889; Auto-Create Scene
          </button>
          <div id="orch-progress-wrap" style="display:none;">
            <div id="orch-step" style="font-size:11px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;"></div>
            <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.2);border-radius:2px;height:6px;overflow:hidden;">
              <div id="orch-bar" style="height:100%;background:var(--gold);width:0%;transition:width 0.5s;"></div>
            </div>
            <div id="orch-result" style="margin-top:8px;font-size:11px;color:#88dd88;letter-spacing:1px;text-transform:uppercase;"></div>
          </div>
        </div>
      </div>

      <!-- Image / Video mode toggle -->
      <div class="field-group">
        <div class="field-label">Mode</div>
        <div class="cl-voice-toggle" id="ig-mode-toggle">
          <button class="cl-vtoggle-btn active" data-mode="image">Image</button>
          <button class="cl-vtoggle-btn" data-mode="video">Video (Wan2.1)</button>
        </div>
      </div>

      <!-- IMAGE ENGINE SECTION -->
      <div id="ig-image-section">
        <div class="field-group">
          <div class="field-label">Engine</div>
          <div class="cl-voice-toggle" id="ig-engine-toggle">
            <button class="cl-vtoggle-btn" data-engine="consistent_character" style="border-color:rgba(255,180,0,0.6);color:#ffcc44;">&#9733; Consistent</button>
            <button class="cl-vtoggle-btn active" data-engine="dalle3">DALL-E 3</button>
            <button class="cl-vtoggle-btn" data-engine="fal_flux">FLUX</button>
            <button class="cl-vtoggle-btn" data-engine="ws_flux">&#9889; WS Flux</button>
            <button class="cl-vtoggle-btn" data-engine="ws_pulid">&#9889; WS PuLID</button>
            <button class="cl-vtoggle-btn" data-engine="comfy" title="Only works when LEVRAM backend runs locally">Local &#9888;</button>
            <button class="cl-vtoggle-btn" data-engine="venice_flux" style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; Venice</button>
            <button class="cl-vtoggle-btn" data-engine="novita_pro"     style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Pro</button>
            <button class="cl-vtoggle-btn" data-engine="novita_photo"   style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Photo</button>
            <button class="cl-vtoggle-btn" data-engine="novita_realism" style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Real</button>
            <button class="cl-vtoggle-btn" data-engine="novita_anime"   style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Anime</button>
            <button class="cl-vtoggle-btn" data-engine="novita_asian"   style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Asian</button>
            <button class="cl-vtoggle-btn" data-engine="novita_hybrid"  style="border-color:rgba(200,0,30,0.5);color:#ff6680;">&#128308; NV Hybrid</button>
          </div>
          <div id="ig-engine-hint" class="field-hint" style="margin-top:4px;">Uses your OpenAI key — best prompt accuracy.</div>
        </div>
      </div>

      <!-- VIDEO ENGINE SECTION -->
      <div id="ig-video-section" style="display:none;">
        <div class="field-group">
          <div class="field-label">Video Engine</div>
          <div class="cl-voice-toggle" id="ig-video-engine-toggle" style="flex-wrap:wrap;gap:4px;">
            <button class="cl-vtoggle-btn active" data-vengine="wan21">Wan 2.1 — Fast</button>
            <button class="cl-vtoggle-btn" data-vengine="wan21_14b">Wan 2.2 14B — Best Free</button>
            <button class="cl-vtoggle-btn" data-vengine="runway_gen4" title="Paid per clip via fal.ai credits">Runway Gen-4.5 &#10022;</button>
            <button class="cl-vtoggle-btn" data-vengine="wan" title="Requires local ComfyUI running">Local (ComfyUI)</button>
          </div>
          <div id="ig-video-engine-hint" class="field-hint" style="margin-top:4px;">WaveSpeed &#9889; models active — cheapest rates. fal.ai on standby.</div>
        </div>
        <div id="ig-wan-local-controls" style="display:none;">
          <div class="field-group">
            <div class="field-label">Steps</div>
            <input type="range" id="ig-wan-steps" min="10" max="50" value="25" oninput="this.nextElementSibling.textContent=this.value" style="width:100%;" />
            <span style="font-size:16px;color:var(--text-dim);">25</span>
          </div>
          <div class="field-group" style="display:flex;gap:8px;">
            <div style="flex:1;">
              <div class="field-label">CFG Scale</div>
              <input type="range" id="ig-wan-cfg" min="1" max="10" step="0.5" value="6" oninput="this.nextElementSibling.textContent=this.value" style="width:100%;"/>
              <span style="font-size:16px;color:var(--text-dim);">6</span>
            </div>
            <div style="flex:1;">
              <div class="field-label">Seed</div>
              <input type="number" id="ig-wan-seed" placeholder="Random" style="width:100%;background:#111228;border:1px solid #333;color:#fff;padding:5px;border-radius:2px;font-size:17px;" />
            </div>
          </div>
        </div>
      </div>

      <!-- SHARED: Prompt, Character, Style, Aspect -->
      <div class="field-group">
        <div class="field-label">Prompt</div>
        <textarea id="ig-prompt" class="script-input" style="height:160px;" placeholder="Describe the scene — or select a character above to auto-fill from their bio"></textarea>
        <div id="ig-char-prompt-notice" style="display:none;font-size:10px;color:#c9a84c;letter-spacing:1px;margin-top:4px;padding:4px 8px;background:rgba(201,168,76,0.08);border-left:2px solid rgba(201,168,76,0.4);border-radius:0 3px 3px 0;"></div>
      </div>
      <div class="field-group">
        <div class="field-label">Character</div>
        <select id="ig-character" class="voice-char-select">
          <option value="">None / Standalone</option>
        </select>
        <div id="ig-char-images-row" style="display:none;flex-wrap:wrap;gap:8px;margin-top:8px;"></div>
      </div>

      <!-- Face References -->
      <div class="field-group">
        <div class="field-label">Face References</div>
        <div style="margin-bottom:10px;">
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:5px;">Person 1</div>
          <select id="ig-char-pick-1" style="width:100%;margin-bottom:6px;font-size:12px;" onchange="igLoadCharacterFaceRefs(this.value,1)">
            <option value="">From Character…</option>
          </select>
          <div id="ig-face-drop-1"
            style="border:2px dashed rgba(201,168,76,0.2);border-radius:4px;padding:10px;text-align:center;cursor:pointer;transition:border-color .2s;"
            ondragover="event.preventDefault();this.style.borderColor='rgba(201,168,76,0.6)'"
            ondragleave="this.style.borderColor='rgba(201,168,76,0.2)'"
            ondrop="igHandleFaceDrop(event,1)"
            onclick="document.getElementById('ig-face-input-1').click()">
            <input type="file" id="ig-face-input-1" accept="image/*" multiple style="display:none" onchange="igAddFaceRefs(this.files,1)" />
            <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">Drop or click — multiple angles</div>
          </div>
          <div id="ig-face-thumbs-1" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        </div>
        <div>
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(201,168,76,0.6);margin-bottom:5px;">Person 2 <span style="font-size:9px;color:var(--text-dim);text-transform:none;letter-spacing:0;">(optional)</span></div>
          <select id="ig-char-pick-2" style="width:100%;margin-bottom:6px;font-size:12px;" onchange="igLoadCharacterFaceRefs(this.value,2)">
            <option value="">From Character…</option>
          </select>
          <div id="ig-face-drop-2"
            style="border:2px dashed rgba(201,168,76,0.12);border-radius:4px;padding:10px;text-align:center;cursor:pointer;transition:border-color .2s;"
            ondragover="event.preventDefault();this.style.borderColor='rgba(201,168,76,0.5)'"
            ondragleave="this.style.borderColor='rgba(201,168,76,0.12)'"
            ondrop="igHandleFaceDrop(event,2)"
            onclick="document.getElementById('ig-face-input-2').click()">
            <input type="file" id="ig-face-input-2" accept="image/*" multiple style="display:none" onchange="igAddFaceRefs(this.files,2)" />
            <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);">Drop or click — multiple angles</div>
          </div>
          <div id="ig-face-thumbs-2" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:6px;">Face pixels go directly to the model — not described in text. Two-person: generates composition then swaps both faces in.</div>
      </div>

      <!-- Scene References -->
      <div class="field-group">
        <div class="field-label" style="display:flex;align-items:center;justify-content:space-between;">
          Scene References <span style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:none;font-weight:400;">optional &middot; AI reads for style/context</span>
        </div>
        <div id="ig-ref-drop"
          style="border:2px dashed rgba(201,168,76,0.2);border-radius:4px;padding:12px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;"
          ondragover="event.preventDefault();this.style.borderColor='rgba(201,168,76,0.6)'"
          ondragleave="this.style.borderColor='rgba(201,168,76,0.2)'"
          ondrop="igHandleRefDrop(event)"
          onclick="document.getElementById('ig-ref-input').click()">
          <input type="file" id="ig-ref-input" accept="image/*" multiple style="display:none" onchange="igAddRefImages(this.files)" />
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);">Drop or click to add photos</div>
        </div>
        <div id="ig-ref-thumbs" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
      </div>

      <div class="field-group" id="ig-style-group">
        <div class="field-label">Style</div>
        <select id="ig-style">
          <option value="cinematic photorealistic">Cinematic Photorealistic</option>
          <option value="dark fantasy digital art">Dark Fantasy</option>
          <option value="comic book illustration">Comic Book</option>
          <option value="anime illustration">Anime</option>
          <option value="oil painting concept art">Concept Art</option>
          <option value="noir film photography">Noir Film</option>
          <option value="hyperrealistic 8k render">Hyperrealistic 8K</option>
          <option value="graphic novel art">Graphic Novel</option>
          <option value="watercolor concept art">Watercolor Concept</option>
        </select>
      </div>
      <div class="field-group">
        <div class="field-label">Aspect Ratio</div>
        <select id="ig-aspect">
          <option value="widescreen">Widescreen 16:9</option>
          <option value="cinematic">Cinematic 2.35:1</option>
          <option value="portrait">Portrait 9:16</option>
          <option value="square">Square 1:1</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="ig-generate-btn" class="gen-btn" style="flex:1;">Generate Image</button>
        <button id="ig-compare-btn" onclick="igCompareAll()" style="flex:1;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.35);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;border-radius:3px;padding:10px;">&#9889; Compare All</button>
      </div>
      <div style="margin-top:6px;">
        <input type="file" id="ig-upload-input" accept="image/*" style="display:none;" onchange="igUploadOwnImage()" />
        <button type="button" onclick="document.getElementById('ig-upload-input').click()"
                style="width:100%;background:rgba(0,0,0,0.4);border:1px dashed rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:8px;border-radius:3px;cursor:pointer;">
          + Bring Your Own Image &#8594; Animate
        </button>
      </div>
      <p id="ig-status" class="status"></p>
    </div>
  </div>

  <!-- RIGHT — Preview + Gallery -->
  <div class="right-panel" style="flex:1;overflow-y:auto;">
    <div class="panel-header">
      <div class="panel-header-icon blue">
        <svg viewBox="0 0 16 16" fill="white"><path d="M1 3h14v10H1z"/><circle cx="5" cy="6" r="1"/><path d="M1 12l4-4 3 3 2-2 6 6"/></svg>
      </div>
      <span class="panel-title">Output</span>
    </div>
    <div style="padding:12px;display:flex;flex-direction:column;gap:12px;">

      <!-- Current result -->
      <div id="ig-result" style="display:none;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="field-label" style="margin:0;">Latest</span>
          <button onclick="document.getElementById('ig-result').style.display='none'" style="background:transparent;border:none;color:var(--text-dim);font-size:19px;cursor:pointer;padding:0 4px;" title="Close">&#10005;</button>
        </div>
        <img id="ig-result-img" style="max-height:50vh;max-width:100%;width:auto;display:block;margin:0 auto;border:1px solid var(--border);border-radius:2px;cursor:zoom-in;" alt="Generated image" onclick="igOpenLightbox(this.src)" />
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap;">
          <button id="ig-lock-char-btn" onclick="igLockToCharacter()" style="background:rgba(40,120,40,0.25);border:1px solid rgba(80,200,80,0.45);color:#6fdf6f;font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">&#8594; Lock to Char</button>
          <button id="ig-upscale-btn" onclick="igUpscale()" style="background:transparent;border:1px solid rgba(60,120,255,0.4);color:#6fa3ff;font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">Upscale &times;4</button>
          <button id="ig-swap-btn" onclick="igSwapFaces()" style="background:transparent;border:1px solid rgba(255,140,0,0.5);color:#ffaa44;font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">Swap Faces</button>
          <button id="ig-animate-btn" onclick="igAnimateImage()" style="background:transparent;border:1px solid rgba(201,168,76,0.5);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">Animate &#8594;</button>
          <button id="ig-download" onclick="igDownloadCurrent()" style="background:transparent;border:1px solid rgba(201,168,76,0.3);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">Download</button>
        </div>
        <!-- I2V options -->
        <div id="ig-i2v-panel" style="display:none;margin-top:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:10px;">
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;">Animate this image</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <select id="ig-i2v-model" onchange="igHandleI2VModelChange(this.value)" style="background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 8px;border-radius:2px;">
              <option value="ws_wan22_spicy" class="rl-only" style="display:none;color:#ff6680;">&#128308; Wan 2.2 Spicy &#9889; — NSFW I2V (WaveSpeed)</option>
              <option value="ws_wan22" selected>Wan 2.2 &#9889; — $0.05/clip (WaveSpeed)</option>
              <option value="ws_wan27">Wan 2.7 &#9889; — latest (WaveSpeed)</option>
              <option value="kling_26">Kling 2.6 Pro — production</option>
              <option value="kling_o1">Kling O1 — Dual Keyframe (start &#8594; end)</option>
              <option value="runway_turbo">Runway Gen-4 Turbo &#10022;</option>
              <option value="runway_gen4_i2v">Runway Gen-4.5 &#10022; — best Runway</option>
            </select>
            <!-- End frame slot — Kling O1 only -->
            <div id="ig-i2v-endframe" style="display:none;margin-top:6px;padding:8px;background:rgba(0,0,0,0.3);border:1px dashed rgba(201,168,76,0.4);border-radius:3px;">
              <div style="font-size:10px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">End Frame (Kling O1)</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:6px;">Upload the final state — model synthesises motion between start and end.</div>
              <div id="ig-i2v-endframe-preview" style="display:none;margin-bottom:6px;">
                <img id="ig-i2v-endframe-img" style="width:80px;height:80px;object-fit:cover;border-radius:3px;border:1px solid rgba(201,168,76,0.4);" />
              </div>
              <input type="file" id="ig-i2v-endframe-input" accept="image/*" style="display:none;" onchange="igLoadEndFrame(this)" />
              <button onclick="document.getElementById('ig-i2v-endframe-input').click()"
                style="width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.3);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:5px;border-radius:2px;cursor:pointer;">
                + Upload End Frame
              </button>
            </div>
            <input id="ig-i2v-prompt" type="text" placeholder="Motion prompt (optional)…" style="background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 8px;border-radius:2px;" />
            <div style="display:flex;gap:6px;align-items:center;">
              <label style="font-size:11px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;">Duration</label>
              <select id="ig-i2v-duration" style="background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.25);color:var(--text-primary);font-family:Rajdhani,sans-serif;font-size:13px;padding:4px 8px;border-radius:2px;">
                <option value="3">3s</option>
                <option value="5" selected>5s</option>
                <option value="8">8s</option>
              </select>
              <button id="ig-i2v-go-btn" onclick="igRunI2V()" style="flex:1;background:linear-gradient(90deg,rgba(139,105,20,0.4),rgba(201,168,76,0.4));border:1px solid rgba(201,168,76,0.5);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">Generate Video</button>
            </div>
            <button onclick="igTestAllI2V()" style="width:100%;background:rgba(0,0,0,0.4);border:1px solid rgba(100,200,100,0.4);color:#88dd88;font-family:Rajdhani,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:6px;border-radius:3px;cursor:pointer;">&#9889; Test All Free Models Simultaneously</button>
            <div id="ig-i2v-status" style="font-size:11px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;min-height:16px;"></div>
            <div id="ig-i2v-compare" style="display:none;margin-top:8px;">
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Model Comparison</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
                <div id="ig-i2v-slot-wan21_i2v"     style="background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);border-radius:3px;padding:6px;min-height:60px;font-size:10px;color:var(--text-dim);"></div>
                <div id="ig-i2v-slot-wan21_14b_i2v" style="background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);border-radius:3px;padding:6px;min-height:60px;font-size:10px;color:var(--text-dim);"></div>
                <div id="ig-i2v-slot-kling_26"      style="background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);border-radius:3px;padding:6px;min-height:60px;font-size:10px;color:var(--text-dim);"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Video result -->
      <div id="ig-video-result" style="display:none;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="field-label" style="margin:0;">Video Output</span>
          <button onclick="document.getElementById('ig-video-result').style.display='none'" style="background:transparent;border:none;color:var(--text-dim);font-size:19px;cursor:pointer;padding:0 4px;">&#10005;</button>
        </div>
        <video id="ig-video-player" controls style="width:100%;border:1px solid var(--border);border-radius:2px;background:#000;max-height:300px;"></video>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;">
          <a id="ig-video-download" download style="font-family:Rajdhani,sans-serif;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);text-decoration:none;border:1px solid rgba(201,168,76,0.3);padding:4px 12px;border-radius:2px;">Download Video</a>
        </div>
      </div>

      <!-- Compare grid -->
      <div id="ig-compare-section" style="display:none;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span class="field-label" style="margin:0;">&#9889; Engine Comparison</span>
          <button onclick="document.getElementById('ig-compare-section').style.display='none'" style="background:transparent;border:none;color:var(--text-dim);font-size:19px;cursor:pointer;padding:0 4px;">&#10005;</button>
        </div>
        <div id="ig-compare-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;"></div>
      </div>

      <!-- Gallery -->
      <div>
        <div class="field-label" style="margin-bottom:8px;">Recent Generations</div>
        <div id="ig-gallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;">
          <div style="color:var(--text-dim);font-size:16px;letter-spacing:2px;text-transform:uppercase;">Loading...</div>
        </div>
      </div>

      <!-- Video Gallery -->
      <div id="ig-video-gallery-section" style="display:none;">
        <div class="field-label" style="margin-bottom:8px;">Generated Videos</div>
        <div id="ig-video-gallery" style="display:flex;flex-direction:column;gap:8px;">
          <div style="color:var(--text-dim);font-size:16px;letter-spacing:2px;text-transform:uppercase;">No videos yet.</div>
        </div>
      </div>

    </div>
  </div>
`;

// Lightbox — append to body (position:fixed, no DOM location dependency)
(function() {
  const lb = document.createElement("div");
  lb.id = "ig-lightbox";
  lb.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9000;align-items:center;justify-content:center;";
  lb.onclick = function(e) { igCloseLightbox(e); };
  lb.innerHTML = `
    <button onclick="igCloseLightbox()" style="position:fixed;top:16px;right:20px;background:transparent;border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:18px;letter-spacing:2px;padding:6px 14px;cursor:pointer;border-radius:2px;">&#10005; CLOSE</button>
    <img id="ig-lightbox-img" style="max-width:92vw;max-height:90vh;object-fit:contain;border:1px solid rgba(201,168,76,0.2);border-radius:2px;" alt="Full size" />
  `;
  document.body.appendChild(lb);
})();

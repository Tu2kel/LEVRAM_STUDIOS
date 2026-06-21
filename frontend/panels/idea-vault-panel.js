document.getElementById("tab-idea-vault").innerHTML = `
  <!-- Capture column -->
  <div class="left-panel" style="flex:0 0 400px;overflow-y:visible;">
    <div class="panel-header">
      <div class="panel-header-icon gold">
        <svg viewBox="0 0 16 16" fill="black"><path d="M8 1.5l1.5 4H15l-3.5 2.5 1.5 4.5L8 10l-4.5 2.5 1.5-4.5L1.5 5.5h5.5L8 1.5z"/></svg>
      </div>
      <span class="panel-title">Idea Vault</span>
      <span class="panel-badge">Capture</span>
    </div>
    <div class="voice-lab">
      <div class="field-group">
        <div class="field-label">Title</div>
        <input id="iv-title" class="script-input" style="height:auto;padding:8px;" placeholder="Name this idea..." />
      </div>
      <div class="field-group">
        <div class="field-label">The Idea</div>
        <textarea id="iv-text" class="script-input" style="min-height:260px;resize:vertical;line-height:1.6;" placeholder="Concept, scene, dialogue, anything worth developing..."></textarea>
      </div>
      <div class="field-group">
        <div class="field-label">Genre</div>
        <input id="iv-genre" class="script-input" style="height:auto;padding:8px;" value="sci-fi action" placeholder="sci-fi action, drama, thriller..." />
      </div>
      <div class="field-group">
        <div style="cursor:pointer;font-size:9px;color:rgba(255,255,255,0.35);letter-spacing:1px;text-transform:uppercase;user-select:none;"
             onclick="const p=document.getElementById('iv-adv-panel');p.style.display=p.style.display==='none'?'flex':'none'">
          &#9658; Advanced (length / pacing)
        </div>
        <div id="iv-adv-panel" style="display:none;gap:8px;margin-top:6px;">
          <div style="flex:1;">
            <div class="field-label">Target Length</div>
            <select id="iv-minutes" class="voice-char-select">
              <option value="1">1 min (skit)</option>
              <option value="2">2 min (skit)</option>
              <option value="5">5 min</option>
              <option value="8" selected>8 min</option>
              <option value="10">10 min</option>
              <option value="12">12 min</option>
              <option value="20">20 min</option>
            </select>
          </div>
          <div style="flex:1;">
            <div class="field-label">Scene Length</div>
            <select id="iv-scene-sec" class="voice-char-select">
              <option value="5" selected>5s — standard</option>
              <option value="8">8s — cinematic</option>
            </select>
          </div>
        </div>
      </div>
      <div class="field-group">
        <div class="field-label">Tags</div>
        <input id="iv-tags" class="script-input" style="height:auto;padding:8px;" placeholder="action, villain (comma separated)" />
      </div>
      <button id="iv-save-btn" class="gen-btn">Save Idea</button>
      <p id="iv-status" class="status"></p>

      <!-- Cast — set BEFORE hitting Develop -->
      <div style="margin-top:12px;padding:10px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.25);border-radius:3px;">
        <div style="font-size:9px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Cast — Set Before Develop</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div class="field-label" style="margin:0;white-space:nowrap;">Char 1:</div>
          <select id="iv-dev-character" class="voice-char-select" style="flex:1;min-width:100px;" data-char-sync
            onchange="LEVRAM_CHAR.set(this.value, this.selectedOptions[0]?.textContent)">
            <option value="">None / Original</option>
          </select>
          <div class="field-label" style="margin:0;white-space:nowrap;">Char 2:</div>
          <select id="iv-dev-character2" class="voice-char-select" style="flex:1;min-width:100px;">
            <option value="">None</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">
          <div class="field-label" style="margin:0;white-space:nowrap;">&#128205; Location:</div>
          <select id="iv-dev-location" class="voice-char-select" style="flex:1;min-width:140px;">
            <option value="">None — AI chooses</option>
          </select>
          <button onclick="window.open('location-lab.html','_blank')" style="background:none;border:1px solid #2a2a2a;color:#666;font-size:11px;padding:4px 8px;border-radius:3px;cursor:pointer;white-space:nowrap;">+ New</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Saved ideas column -->
  <div style="flex:0 0 300px;overflow-y:auto;max-height:80vh;">
    <div class="panel-header">
      <div class="panel-header-icon blue">
        <svg viewBox="0 0 16 16" fill="white"><path d="M2 3h12v1H2zm0 3h12v1H2zm0 3h8v1H2z"/></svg>
      </div>
      <span class="panel-title">Saved Ideas</span>
    </div>
    <div id="iv-list" style="padding:12px;display:flex;flex-direction:column;gap:8px;">
      <p style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No ideas saved yet.</p>
    </div>
  </div>

  <!-- Story development panel (right, shown after Develop) -->
  <div id="iv-story-panel" style="flex:1;overflow-y:auto;max-height:80vh;display:none;">
    <div class="panel-header">
      <div class="panel-header-icon gold">
        <svg viewBox="0 0 16 16" fill="black"><path d="M2 2h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/></svg>
      </div>
      <span class="panel-title" id="iv-story-title">Story Breakdown</span>
      <span id="iv-story-duration" class="panel-badge" style="background:rgba(201,168,76,0.15);color:var(--gold);">—</span>
    </div>
    <div style="padding:12px;">
      <div id="iv-story-meta" style="margin-bottom:12px;font-size:12px;color:var(--text-dim);line-height:1.6;"></div>
      <div id="iv-reel-row" style="display:none;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;"></div>

      <!-- Scene list -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
        <button onclick="ivSaveSceneEdits()"
          style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;border-radius:2px;cursor:pointer;">
          &#128190; Save Edits
        </button>
      </div>
      <div id="iv-scene-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <button onclick="ivAddScene()" style="width:100%;margin-top:8px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);color:rgba(255,255,255,0.35);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:6px;border-radius:2px;cursor:pointer;">
        + Add Scene
      </button>

      <!-- Director's Notes — Revision without re-develop -->
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
        <div style="font-size:9px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">&#127916; Director's Notes — Revise in Place</div>
        <textarea id="iv-revision-notes" rows="3" placeholder="Tell Lena what to change — e.g. 'make Act 2 more brutal', 'rewrite scene 4 so Severus wins the fight', 'add more fog in the alley scenes'..."
          style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.25);color:var(--text);font-family:Rajdhani,sans-serif;font-size:12px;padding:8px 10px;border-radius:3px;resize:vertical;outline:none;line-height:1.5;"></textarea>
        <button onclick="ivReviseStory()"
          style="margin-top:6px;width:100%;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.35);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:7px;border-radius:3px;cursor:pointer;">
          &#9999; Apply Notes — Keep Title &amp; Structure
        </button>
        <div id="iv-revision-status" style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:6px;min-height:14px;"></div>
      </div>

      <!-- Director Panel -->
      <div style="margin-top:16px;border-top:1px solid rgba(201,168,76,0.12);padding-top:0;">
        <div style="background:#0a0910;border:1px solid rgba(255,255,255,0.07);border-radius:5px;overflow:hidden;">

          <!-- Panel label row -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:8px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.2);">&#9670; Director Panel</span>
            </div>
            <div id="iv-cost-est" style="font-size:9px;color:rgba(201,168,76,0.5);letter-spacing:1px;"></div>
          </div>

          <!-- Model pills -->
          <div style="display:flex;align-items:center;gap:0;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);overflow-x:auto;">
            <span style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.18);margin-right:8px;white-space:nowrap;">Model</span>
            <div style="display:flex;gap:4px;flex-wrap:nowrap;">
              <label class="dp-pill">
                <input type="radio" name="iv-model-r" value="ws_wan22" id="iv-model" style="display:none;" checked onchange="ivUpdateCostEst()" />
                <span class="dp-pill-label">Wan 2.2 &#9889;</span>
              </label>
              <label class="dp-pill">
                <input type="radio" name="iv-model-r" value="ws_wan27" style="display:none;" onchange="ivUpdateCostEst()" />
                <span class="dp-pill-label">Wan 2.7</span>
              </label>
              <label class="dp-pill">
                <input type="radio" name="iv-model-r" value="kling_26" style="display:none;" onchange="ivUpdateCostEst()" />
                <span class="dp-pill-label">Kling 2.6</span>
              </label>
              <label class="dp-pill">
                <input type="radio" name="iv-model-r" value="ws_wan22_spicy" style="display:none;" onchange="ivUpdateCostEst()" />
                <span class="dp-pill-label" style="color:rgba(255,100,100,0.7);">&#128308; Spicy</span>
              </label>
            </div>
            <div style="width:1px;background:rgba(255,255,255,0.06);margin:0 10px;height:16px;flex-shrink:0;"></div>
            <span style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.18);margin-right:8px;white-space:nowrap;">Clip</span>
            <select id="iv-scene-sec-dp" style="background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-family:Rajdhani,sans-serif;font-size:11px;padding:3px 7px;border-radius:3px;cursor:pointer;" onchange="document.getElementById('iv-scene-sec').value=this.value;ivUpdateCostEst()">
              <option value="5">5s</option>
              <option value="8">8s</option>
              <option value="10">10s</option>
            </select>
          </div>

          <!-- Action row -->
          <div style="display:flex;gap:6px;padding:8px 12px;align-items:center;">
            <button id="iv-keyframe-btn" onclick="ivGenerateKeyframes()"
              style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);font-family:Rajdhani,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:7px 12px;border-radius:3px;cursor:pointer;white-space:nowrap;">
              &#128444; Keyframes
            </button>
            <button id="iv-approve-btn" onclick="ivApproveAndGenerate()"
              style="flex:1;background:linear-gradient(90deg,#7a5800,#c9a84c);border:none;color:#000;font-family:Rajdhani,sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;padding:8px 16px;border-radius:3px;cursor:pointer;white-space:nowrap;">
              GENERATE &#9654;
            </button>
          </div>

        </div>

        <!-- Animate Approved (shown after keyframe review) -->
        <div id="iv-animate-bar" style="display:none;margin-top:8px;padding:10px 12px;background:rgba(33,150,243,0.05);border:1px solid rgba(33,150,243,0.2);border-radius:4px;">
          <div style="font-size:9px;color:#90caf9;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Select keyframes to animate</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button onclick="ivSelectAllKeyframes(true)" style="background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:1px;padding:4px 8px;cursor:pointer;border-radius:2px;">All</button>
            <button onclick="ivSelectAllKeyframes(false)" style="background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:1px;padding:4px 8px;cursor:pointer;border-radius:2px;">None</button>
            <button id="iv-animate-selected-btn" onclick="ivAnimateSelected()" style="flex:1;background:rgba(33,150,243,0.15);border:1px solid rgba(33,150,243,0.4);color:#90caf9;font-family:Rajdhani,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:7px;border-radius:3px;cursor:pointer;">
              &#127916; Animate Selected
            </button>
          </div>
        </div>
      </div>
      <div id="iv-approve-status" style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5);"></div>
    </div>
  </div>
`;

// Pill-radio sync: keep iv-scene-sec in sync with the dp clone
(function(){
  const dp = document.getElementById("iv-scene-sec-dp");
  const orig = document.getElementById("iv-scene-sec");
  if (dp && orig) orig.addEventListener("change", () => { dp.value = orig.value; });
})();

// Global model reader — reads radio group, falls back to first radio value
window.ivGetModel = function() {
  const checked = document.querySelector('input[name="iv-model-r"]:checked');
  return checked?.value || "ws_wan22";
};

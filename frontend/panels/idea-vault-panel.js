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

      <!-- Approve bar -->
      <div style="margin-top:16px;border-top:1px solid rgba(201,168,76,0.15);padding-top:14px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <div class="field-label" style="margin:0;white-space:nowrap;">Quality:</div>
          <select id="iv-model" class="voice-char-select" style="flex:2;min-width:160px;" onchange="ivUpdateCostEst()">
            <option value="ws_wan22" selected>Wan 2.2 &#9889; — WaveSpeed</option>
            <option value="ws_wan22_spicy">&#128308; Wan 2.2 Spicy — Uncensored</option>
            <option value="ws_wan27">Wan 2.7 &#9889; — WaveSpeed latest</option>
            <option value="kling_26">Kling 2.6 Pro — production quality</option>
          </select>
        </div>
        <div id="iv-cost-est" style="font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:1px;margin-bottom:10px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="iv-keyframe-btn" onclick="ivGenerateKeyframes()"
            style="flex:1;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.4);color:rgba(201,168,76,0.8);font-family:Rajdhani,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:7px 14px;border-radius:3px;cursor:pointer;white-space:nowrap;">
            &#128444; Keyframes &#8594; Review
          </button>
          <button id="iv-approve-btn" onclick="ivApproveAndGenerate()"
            style="flex:2;background:linear-gradient(90deg,rgba(139,105,20,0.6),rgba(201,168,76,0.6));border:1px solid rgba(201,168,76,0.6);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:8px 20px;border-radius:3px;cursor:pointer;white-space:nowrap;">
            &#9989; APPROVE + GENERATE
          </button>
        </div>
        <!-- Animate Approved (shown after keyframe review) -->
        <div id="iv-animate-bar" style="display:none;margin-top:10px;padding:10px;background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.25);border-radius:3px;">
          <div style="font-size:11px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Review keyframes above — select which to animate</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button onclick="ivSelectAllKeyframes(true)"
              style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:1px;padding:4px 8px;cursor:pointer;border-radius:2px;">All</button>
            <button onclick="ivSelectAllKeyframes(false)"
              style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:1px;padding:4px 8px;cursor:pointer;border-radius:2px;">None</button>
            <button id="iv-animate-selected-btn" onclick="ivAnimateSelected()"
              style="flex:1;background:linear-gradient(90deg,rgba(33,150,243,0.5),rgba(100,181,246,0.5));border:1px solid rgba(33,150,243,0.6);color:#90caf9;font-family:Rajdhani,sans-serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:7px 16px;border-radius:3px;cursor:pointer;">
              &#127916; Animate Selected with Kling
            </button>
          </div>
        </div>
      </div>
      <div id="iv-approve-status" style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5);"></div>
    </div>
  </div>
`;

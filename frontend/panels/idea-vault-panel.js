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

`;

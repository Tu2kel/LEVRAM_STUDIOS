// Redlight glitter canvas
(function() {
  const canvas = document.createElement("canvas");
  canvas.id = "rl-glitter";
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:8888;display:none;";
  document.body.appendChild(canvas);
})();

// Backend Console drawer
(function() {
  const drawer = document.createElement("div");
  drawer.id = "bc-drawer";
  drawer.innerHTML = `
    <div class="bc-header">
      <span class="bc-title">BACKEND CONSOLE</span>
      <span id="bc-live-dot"></span>
      <span class="bc-live-label">LIVE</span>
      <div style="flex:1"></div>
      <button class="bc-btn" onclick="BC.clear()">Clear</button>
      <button class="bc-btn" onclick="BC.toggle()">&#9660; Close</button>
    </div>
    <div id="bc-feed" class="bc-feed"></div>
  `;
  document.body.appendChild(drawer);
})();

// Image Gen picker modal (shared by inline Character Lab)
(function() {
  const picker = document.createElement("div");
  picker.id = "cl-gen-picker";
  picker.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 20px 20px;";
  picker.innerHTML = `
    <div style="width:100%;max-width:860px;background:#0d0a18;border:1px solid rgba(100,160,255,0.3);border-radius:8px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(100,160,255,0.15);">
        <span style="font-family:Orbitron,sans-serif;font-size:11px;letter-spacing:3px;color:#7eb3f5;text-transform:uppercase;">Select from Image Gen Gallery</span>
        <button onclick="clCloseGenPicker()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;line-height:1;">&#10005;</button>
      </div>
      <div id="cl-gen-picker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;padding:16px;max-height:60vh;overflow-y:auto;">
        <div style="color:rgba(255,255,255,0.3);font-size:11px;grid-column:1/-1;text-align:center;padding:20px;">Loading gallery&#8230;</div>
      </div>
      <div id="cl-gen-picker-status" style="padding:10px 18px;font-size:11px;color:#7eb3f5;letter-spacing:1px;min-height:32px;border-top:1px solid rgba(100,160,255,0.1);"></div>
    </div>
  `;
  document.body.appendChild(picker);
})();

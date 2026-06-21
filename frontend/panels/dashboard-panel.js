document.getElementById("tab-dashboard").innerHTML = `
  <div class="db-bg">
    <div class="db-bg-img"></div>
    <div class="db-bg-vignette"></div>
  </div>
  <div class="db-content">
    <div class="db-hero">
      <div class="db-hero-left">
        <div class="db-studio-label">LEVRAM STUDIOS</div>
        <div class="db-cc-label">COMMAND CENTER</div>
      </div>
      <div class="db-hero-right">
        <div class="db-clock" id="db-clock">--:--:--</div>
        <div class="db-date" id="db-date"></div>
        <button class="db-refresh-btn-hero" onclick="dbLoad()" title="Refresh">↻</button>
      </div>
    </div>
    <div id="db-active-job" class="db-job-banner" style="display:none;"></div>
    <div class="db-stat-grid">
      <div class="db-stat-card"><div class="db-stat-glow"></div><span class="db-stat-num" id="db-stat-ideas">—</span><span class="db-stat-label">IDEAS</span></div>
      <div class="db-stat-card"><div class="db-stat-glow"></div><span class="db-stat-num" id="db-stat-chars">—</span><span class="db-stat-label">CHARACTERS</span></div>
      <div class="db-stat-card db-stat-card--accent"><div class="db-stat-glow db-stat-glow--hot"></div><span class="db-stat-num" id="db-stat-shots">—</span><span class="db-stat-label">SHOTS</span></div>
      <div class="db-stat-card db-stat-card--accent"><div class="db-stat-glow db-stat-glow--hot"></div><span class="db-stat-num" id="db-stat-films">—</span><span class="db-stat-label">CLIPS</span></div>
      <div class="db-stat-card"><div class="db-stat-glow"></div><span class="db-stat-num" id="db-stat-runtime">—</span><span class="db-stat-label">EST. RUNTIME</span></div>
    </div>
    <div class="db-launch-bar">
      <button class="db-launch-btn" onclick="switchTab('idea-vault')"><span class="db-launch-icon">✦</span><span class="db-launch-text">NEW IDEA</span></button>
      <button class="db-launch-btn" onclick="document.querySelector('[data-tab=characters]').click()"><span class="db-launch-icon">◈</span><span class="db-launch-text">CHARACTERS</span></button>
      <button class="db-launch-btn" onclick="window.open('timeline.html','_blank')"><span class="db-launch-icon">▶</span><span class="db-launch-text">TIMELINE</span></button>
      <button class="db-launch-btn" onclick="switchTab('shot-builder')"><span class="db-launch-icon">◉</span><span class="db-launch-text">PRODUCTION</span></button>
      <button class="db-launch-btn" onclick="switchTab('image-gen')"><span class="db-launch-icon">◆</span><span class="db-launch-text">IMAGE GEN</span></button>
    </div>
    <div class="db-mid-row">
      <div class="db-panel db-wip-panel">
        <div class="db-panel-header">
          <span class="db-panel-label">// WHERE I LEFT OFF</span>
          <button class="db-refresh-btn-hero" onclick="dbLoad()" style="border-radius:3px;width:auto;padding:0 10px;font-size:10px;letter-spacing:.08em;">↻ REFRESH</button>
          <div class="db-panel-line"></div>
        </div>
        <div id="db-left-off" class="db-left-off-wrap"></div>
      </div>
      <div class="db-panel db-panel-projects">
        <div class="db-panel-header"><span class="db-panel-label">// SAGAS</span><div class="db-panel-line"></div></div>
        <div id="db-projects-grid" class="db-projects-grid"></div>
      </div>
    </div>
    <div class="db-panel db-panel-clips">
      <div class="db-panel-header">
        <span class="db-panel-label">// RECENT CLIPS</span>
        <span class="db-panel-sub">hover to preview</span>
        <div class="db-panel-line"></div>
      </div>
      <div id="db-clips-grid" class="db-clips-grid"></div>
    </div>
  </div>
  <div id="db-clip-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;align-items:center;justify-content:center;" onclick="if(event.target===this)dbCloseClip()">
    <div style="position:relative;max-width:900px;width:92%;">
      <video id="db-clip-modal-video" controls autoplay style="width:100%;border-radius:4px;box-shadow:0 0 60px rgba(180,0,0,.5);"></video>
      <button onclick="dbCloseClip()" style="position:absolute;top:-14px;right:-14px;background:#cc1a1a;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:15px;font-weight:900;color:#fff;">✕</button>
    </div>
  </div>
`;

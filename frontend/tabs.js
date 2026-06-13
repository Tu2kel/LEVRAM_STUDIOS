// ─── Nav Tab System ───────────────────────────────────────
(function () {
  // Tabs that render inline in the row-2 content area
  const TAB_PANELS = {
    "idea-vault":   { id: "tab-idea-vault",  display: "flex" },
    "shot-builder": { id: "tab-main",        display: "grid" },
    "image-gen":    { id: "tab-image-gen",   display: "flex" },
  };

  // External pages opened in a new tab
  const EXTERNAL_TABS = {
    "timeline": "timeline.html",
    "projects": "projects.html",
    "settings": "settings.html",
    "title-seq":   "title-sequence.html",
    "voice-clone": "voice-clone.html",
    "music":       "music.html",
    "export":      "export.html",
    "assets":      "assets.html",
    "story":       "story-engine.html",
  };

  const ALL_PANEL_IDS = [...new Set(Object.values(TAB_PANELS).map(v => v.id))];

  function hideAllTabPanels() {
    ALL_PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  function hideCharacterWorkspace() {
    const el = document.getElementById("ws-character");
    if (el) el.style.display = "none";
  }

  function showTab(tabKey) {
    const cfg = TAB_PANELS[tabKey];
    if (!cfg) return;
    hideAllTabPanels();
    hideCharacterWorkspace(); // row-4 character panel should close when switching tabs
    const el = document.getElementById(cfg.id);
    if (el) el.style.display = cfg.display;
  }

  function setActiveNav(btn) {
    document.querySelectorAll(".nav-btn[data-tab]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-btn[data-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;

        // External pages
        if (EXTERNAL_TABS[tab]) {
          window.open(EXTERNAL_TABS[tab], "_blank");
          return;
        }

        // Characters: lives in the row-4 workspace area
        if (tab === "characters") {
          setActiveNav(btn);
          hideAllTabPanels();
          const panel = document.getElementById("ws-character");
          if (panel) {
            panel.style.display    = "flex";
            panel.style.flexDirection = "column";
            panel.style.minHeight  = "400px";
            panel.style.overflow   = "hidden";
          }
          return;
        }

        // Inline tab panels (row 2) — also collapse character workspace
        setActiveNav(btn);
        showTab(tab);
      });
    });

    // Default: show Production (Shot Builder + Voice Lab) on load
    showTab("shot-builder");
  });

  window.showTab = showTab;
})();

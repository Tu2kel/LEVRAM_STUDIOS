// ─── Nav Tab System ───────────────────────────────────────
(function () {
  // Tabs that render inline in the row-2 content area
  function _batteryVis(show) {
    const el = document.getElementById("project-battery-host");
    if (el) el.style.display = show ? "" : "none";
  }

  const TAB_PANELS = {
    "dashboard":    { id: "tab-dashboard",   display: "flex", onShow: () => { _batteryVis(false); window.dbLoad?.(); } },
    "idea-vault":   { id: "tab-idea-vault",  display: "flex", onShow: () => _batteryVis(true) },
    "shot-builder": { id: "tab-main",        display: "grid", onShow: () => _batteryVis(true) },
    "image-gen":    { id: "tab-image-gen",   display: "flex", onShow: () => { _batteryVis(true); window.igLoadCharacters?.(); } },
    "music":        { id: "tab-music",       display: "flex", onShow: () => _batteryVis(true) },
  };

  // External pages opened in a new tab
  const EXTERNAL_TABS = {
    "timeline":  "timeline.html",
    "projects":  "projects.html",
    "settings":  "settings.html",
    "title-seq":   "title-sequence.html",
    "voice-clone": "voice-clone.html",
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
    if (el) {
      el.style.display  = "none";
      el.style.gridRow  = "4";      // restore original row
      el.style.height   = "";
    }
  }

  function showTab(tabKey) {
    const cfg = TAB_PANELS[tabKey];
    if (!cfg) return;
    hideAllTabPanels();
    hideCharacterWorkspace();
    const el = document.getElementById(cfg.id);
    if (el) el.style.display = cfg.display;
    cfg.onShow?.();
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
          let extUrl = EXTERNAL_TABS[tab];
          if (tab === "timeline") {
            const proj = localStorage.getItem("levram_active_project") || "";
            if (proj) extUrl += `?project=${encodeURIComponent(proj)}`;
          }
          window.open(extUrl, "_blank");
          return;
        }

        // Characters: lives in the row-4 workspace area
        if (tab === "characters") {
          setActiveNav(btn);
          hideAllTabPanels();
          _batteryVis(true);
          const panel = document.getElementById("ws-character");
          if (panel) {
            panel.style.display       = "flex";
            panel.style.flexDirection = "column";
            panel.style.gridRow       = "2 / -1";   // fill all rows below battery
            panel.style.minHeight     = "0";
            panel.style.height        = "calc(100vh - 73px)";
            panel.style.overflow      = "hidden";
          }
          return;
        }

        // Inline tab panels (row 2) — also collapse character workspace
        setActiveNav(btn);
        showTab(tab);
      });
    });

    // Default: show Dashboard on load
    showTab("dashboard");
  });

  window.showTab = showTab;

  // Public helper: switch tab AND update nav highlight
  window.switchTab = function (tabKey) {
    showTab(tabKey);
    document.querySelectorAll(".nav-btn[data-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tabKey);
    });
  };
})();

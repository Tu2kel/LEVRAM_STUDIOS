// ─── Nav Tab System ───────────────────────────────────────
(function () {
  // Map each data-tab value to its panel ID and the display value to use when visible
  const TAB_PANELS = {
    "voice-lab":   { id: "tab-main",        display: "grid" },
    "shot-builder":{ id: "tab-main",        display: "grid" },
    "idea-vault":  { id: "tab-idea-vault",  display: "flex" },
    "image-gen":   { id: "tab-image-gen",   display: "flex" },
  };

  // Get unique panel IDs
  const ALL_PANEL_IDS = [...new Set(Object.values(TAB_PANELS).map(v => v.id))];

  function hideAllTabPanels() {
    ALL_PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  function showTab(tabKey) {
    const cfg = TAB_PANELS[tabKey];
    if (!cfg) return;
    hideAllTabPanels();
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

        if (tab === "story") {
          window.open("story-engine.html", "_blank");
          return;
        }
        if (tab === "music") {
          window.open("music.html", "_blank");
          return;
        }
        if (tab === "timeline") {
          window.open("timeline.html", "_blank");
          return;
        }
        if (tab === "export") {
          window.open("export.html", "_blank");
          return;
        }
        if (tab === "settings") {
          window.open("settings.html", "_blank");
          return;
        }
        if (tab === "title-seq") {
          window.open("title-sequence.html", "_blank");
          return;
        }
        if (tab === "voice-clone") {
          window.open("voice-clone.html", "_blank");
          return;
        }
        if (tab === "assets") {
          window.open("assets.html", "_blank");
          return;
        }
        if (tab === "projects") {
          window.open("projects.html", "_blank");
          return;
        }

        setActiveNav(btn);
        showTab(tab);
      });
    });

    // Ensure voice-lab is shown on load (default active tab)
    showTab("voice-lab");
  });

  window.showTab = showTab;
})();

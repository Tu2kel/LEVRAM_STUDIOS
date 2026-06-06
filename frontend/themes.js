/**
 * LEVRAM Studios — Multi-Theme Engine
 * Runs early (in <head>, before render) to prevent flash.
 * Injects CSS variable overrides via data-theme attribute on <html>.
 *
 * Themes:
 *   dark    — Dark Studio      (sapphire-black + gold, default)
 *   royal   — Royal Crimson    (House of Kel — deep burgundy + gold)
 *   federal — Federal          (Imperio — patriotic crimson + navy + gold)
 *   ivory   — Ivory            (warm parchment — light elegant mode)
 *   navy    — Navy             (deep navy blue + gold)
 */
(function () {

  // ── Theme definitions ──────────────────────────────────────────────────────

  var THEMES = {

    dark: {
      label:  "Dark Studio",
      accent: "#09080f",
      swatch: "linear-gradient(135deg, #09080f 0%, #1a1838 100%)",
      vars:   {},  // default — app.css handles everything
      body:   null,
      grid:   null,
    },

    royal: {
      label:  "Royal Crimson",
      accent: "#3d0810",
      swatch: "linear-gradient(135deg, #1a0206 0%, #5a0c1c 50%, #c9a84c 100%)",
      vars: {
        "--black":         "#070103",
        "--surface":       "#110408",
        "--surface2":      "#1c060e",
        "--surface3":      "#260a14",
        "--text":          "#f5ede0",
        "--text-muted":    "#b09070",
        "--text-dim":      "#6a2830",
        "--royal-purple":  "#5a0c18",
        "--border":        "rgba(201,168,76,0.40)",
        "--border-strong": "rgba(201,168,76,0.72)",
        "--border-subtle": "rgba(201,168,76,0.16)",
        "--royal-gradient":"linear-gradient(135deg,rgba(140,10,30,0.30) 0%,transparent 60%)",
        "--gold-glow":     "0 0 24px rgba(201,168,76,0.32), 0 0 7px rgba(201,168,76,0.18)",
        "--gold-glow-sm":  "0 0 12px rgba(201,168,76,0.26)",
      },
      body: [
        "radial-gradient(ellipse at 14% 8%,  rgba(130,6,20,0.70) 0%, transparent 46%)",
        "radial-gradient(ellipse at 88% 92%, rgba(90,4,14,0.55)  0%, transparent 50%)",
        "radial-gradient(ellipse at 50% 50%, rgba(40,2,8,0.60)   0%, transparent 70%)",
        "#070103",
      ].join(","),
      grid: [
        "repeating-linear-gradient(92deg,transparent,transparent 120px,rgba(201,60,60,0.022) 121px,rgba(201,60,60,0.022) 122px)",
        "repeating-linear-gradient(180deg,transparent,transparent 80px,rgba(201,60,60,0.009) 81px,rgba(201,60,60,0.009) 82px)",
      ].join(","),
      extra: `
        html[data-theme="royal"] .top-bar {
          background: linear-gradient(180deg, #180308 0%, #0e0206 100%) !important;
          border-bottom: 1px solid rgba(160,20,40,0.40) !important;
          box-shadow: 0 4px 28px rgba(100,5,15,0.70) !important;
        }
        html[data-theme="royal"] .panel-header {
          background: linear-gradient(90deg,rgba(140,10,30,0.22),transparent) !important;
        }
        html[data-theme="royal"] .shot-card:hover {
          border-color: rgba(180,30,50,0.55) !important;
        }
        html[data-theme="royal"] .nav-btn:hover,
        html[data-theme="royal"] .nav-btn.active {
          box-shadow: 0 0 10px rgba(180,30,50,0.30) !important;
        }
        html[data-theme="royal"] body::after {
          content: "";
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #9b111e, #c9a84c, #9b111e, transparent);
          z-index: 9998;
          pointer-events: none;
        }
      `,
    },

    federal: {
      label:  "Federal",
      accent: "#06080d",
      swatch: "linear-gradient(135deg, #9b111e 0%, #060810 45%, #1f4fa3 100%)",
      vars: {
        "--black":         "#05080d",
        "--surface":       "#090e18",
        "--surface2":      "#0e1420",
        "--surface3":      "#131e2e",
        "--text":          "#edf2f9",
        "--text-muted":    "#6888b0",
        "--text-dim":      "#2c4060",
        "--royal-purple":  "#1a3060",
        "--border":        "rgba(201,168,76,0.32)",
        "--border-strong": "rgba(201,168,76,0.62)",
        "--border-subtle": "rgba(201,168,76,0.12)",
        "--royal-gradient":"linear-gradient(135deg,rgba(10,20,60,0.28) 0%,transparent 60%)",
        "--gold-glow":     "0 0 22px rgba(201,168,76,0.30), 0 0 6px rgba(201,168,76,0.14)",
        "--gold-glow-sm":  "0 0 10px rgba(201,168,76,0.24)",
      },
      body: [
        "radial-gradient(ellipse at 6%  12%, rgba(155,17,30,0.60)  0%, transparent 42%)",
        "radial-gradient(ellipse at 94% 88%, rgba(31,79,163,0.55)  0%, transparent 44%)",
        "radial-gradient(ellipse at 50% 50%, rgba(6,8,18,0.80)    0%, transparent 65%)",
        "#050810",
      ].join(","),
      grid: [
        "repeating-linear-gradient(92deg,transparent,transparent 120px,rgba(201,168,76,0.014) 121px,rgba(201,168,76,0.014) 122px)",
        "repeating-linear-gradient(180deg,transparent,transparent 80px,rgba(201,168,76,0.006) 81px,rgba(201,168,76,0.006) 82px)",
      ].join(","),
      extra: `
        html[data-theme="federal"] body::after {
          content: "";
          position: fixed;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, #9b111e 0%, #9b111e 33%, #c9a84c 33%, #f5f5f5 50%, #c9a84c 66%, #1f4fa3 66%, #1f4fa3 100%);
          z-index: 9998;
          pointer-events: none;
        }
        html[data-theme="federal"] .top-bar {
          background: linear-gradient(180deg, #08101e 0%, #060810 100%) !important;
          border-bottom: 1px solid rgba(155,17,30,0.35) !important;
        }
      `,
    },

    ivory: {
      label:  "Ivory",
      accent: "#f0ebe0",
      swatch: "linear-gradient(135deg, #f5f0e4 0%, #ede8da 60%, #c9a84c 100%)",
      vars: {
        "--black":          "#ece6d8",
        "--surface":        "#e5dece",
        "--surface2":       "#dcd5c4",
        "--surface3":       "#d2cbb8",
        "--text":           "#1a1208",
        "--text-muted":     "#6a5840",
        "--text-dim":       "#a09070",
        "--gold":           "#8b6914",
        "--gold-light":     "#b88c2c",
        "--gold-dark":      "#5a4010",
        "--gold-bright":    "#a07820",
        "--platinum":       "#806040",
        "--silver":         "#907050",
        "--royal-purple":   "#4a3060",
        "--red":            "#7a0c14",
        "--red-bright":     "#9e1020",
        "--blue":           "#1a3a80",
        "--blue-bright":    "#2454b8",
        "--border":         "rgba(139,105,20,0.32)",
        "--border-strong":  "rgba(139,105,20,0.64)",
        "--border-subtle":  "rgba(139,105,20,0.14)",
        "--gold-glow":      "0 0 16px rgba(139,105,20,0.20), 0 0 5px rgba(139,105,20,0.12)",
        "--gold-glow-sm":   "0 0 8px rgba(139,105,20,0.18)",
        "--royal-gradient": "linear-gradient(135deg,rgba(74,48,96,0.08) 0%,transparent 60%)",
        "--chrome-gradient":"linear-gradient(180deg,#8b6914 0%,#a07820 20%,#c9a84c 45%,#b88c2c 70%,#8b6914 100%)",
      },
      body: [
        "radial-gradient(ellipse at 20% 15%, rgba(210,195,155,0.40) 0%, transparent 50%)",
        "radial-gradient(ellipse at 80% 85%, rgba(195,180,140,0.25) 0%, transparent 50%)",
        "#ece6d8",
      ].join(","),
      grid: [
        "repeating-linear-gradient(92deg,transparent,transparent 120px,rgba(139,105,20,0.030) 121px,rgba(139,105,20,0.030) 122px)",
        "repeating-linear-gradient(180deg,transparent,transparent 80px,rgba(139,105,20,0.014) 81px,rgba(139,105,20,0.014) 82px)",
      ].join(","),
      extra: `
        html[data-theme="ivory"] body {
          color: #1a1208 !important;
        }
        html[data-theme="ivory"] input,
        html[data-theme="ivory"] textarea,
        html[data-theme="ivory"] select {
          background: rgba(255,255,255,0.75) !important;
          color: #1a1208 !important;
          border-color: rgba(139,105,20,0.35) !important;
        }
        html[data-theme="ivory"] input::placeholder,
        html[data-theme="ivory"] textarea::placeholder {
          color: rgba(106,88,64,0.50) !important;
        }
        html[data-theme="ivory"] .shot-card,
        html[data-theme="ivory"] .panel,
        html[data-theme="ivory"] .svc,
        html[data-theme="ivory"] .st-section,
        html[data-theme="ivory"] .vc-half,
        html[data-theme="ivory"] .vc-lib,
        html[data-theme="ivory"] .pm-section,
        html[data-theme="ivory"] .ms-section {
          background: rgba(255,255,255,0.60) !important;
          border-color: rgba(139,105,20,0.28) !important;
        }
        html[data-theme="ivory"] .top-bar,
        html[data-theme="ivory"] .vc-header,
        html[data-theme="ivory"] .pm-header,
        html[data-theme="ivory"] .ms-header {
          background: linear-gradient(180deg, #dcd5c4 0%, #ccc5b2 100%) !important;
          box-shadow: 0 4px 28px rgba(0,0,0,0.12) !important;
          border-color: rgba(139,105,20,0.35) !important;
        }
        html[data-theme="ivory"] .panel-header {
          background: linear-gradient(90deg,rgba(139,105,20,0.10),transparent) !important;
        }
        html[data-theme="ivory"] .gen-btn,
        html[data-theme="ivory"] .vc-clone-btn,
        html[data-theme="ivory"] .pm-create-btn {
          color: #1a1208 !important;
        }
        html[data-theme="ivory"] .vc-title,
        html[data-theme="ivory"] .pm-title,
        html[data-theme="ivory"] .ms-title,
        html[data-theme="ivory"] .st-title,
        html[data-theme="ivory"] .vc-section-title,
        html[data-theme="ivory"] .pm-section-title,
        html[data-theme="ivory"] .st-section-title {
          color: #5a4010 !important;
        }
        html[data-theme="ivory"] .vc-back,
        html[data-theme="ivory"] .pm-back,
        html[data-theme="ivory"] .st-back {
          background: rgba(236,230,216,0.9) !important;
          color: #5a4010 !important;
        }
        html[data-theme="ivory"] .vc-voice-item,
        html[data-theme="ivory"] .pm-project-card {
          background: rgba(245,240,228,0.85) !important;
          border-color: rgba(139,105,20,0.30) !important;
        }
        html[data-theme="ivory"] .vc-voice-name,
        html[data-theme="ivory"] .pm-project-name,
        html[data-theme="ivory"] .st-key {
          color: #3a2810 !important;
        }
        html[data-theme="ivory"] label,
        html[data-theme="ivory"] .vc-label,
        html[data-theme="ivory"] .pm-label {
          color: #6a5840 !important;
        }
      `,
    },

    navy: {
      label:  "Navy",
      accent: "#040810",
      swatch: "linear-gradient(135deg, #040810 0%, #0c1c38 50%, #c9a84c 100%)",
      vars: {
        "--black":         "#040810",
        "--surface":       "#071428",
        "--surface2":      "#0c1c38",
        "--surface3":      "#112548",
        "--text":          "#d8eaf8",
        "--text-muted":    "#5880a8",
        "--text-dim":      "#2a4870",
        "--royal-purple":  "#1a3580",
        "--border":        "rgba(201,168,76,0.30)",
        "--border-strong": "rgba(201,168,76,0.60)",
        "--border-subtle": "rgba(201,168,76,0.11)",
        "--royal-gradient":"linear-gradient(135deg,rgba(20,40,120,0.30) 0%,transparent 60%)",
        "--gold-glow":     "0 0 22px rgba(201,168,76,0.26), 0 0 6px rgba(201,168,76,0.14)",
        "--gold-glow-sm":  "0 0 10px rgba(201,168,76,0.20)",
      },
      body: [
        "radial-gradient(ellipse at 18% 10%, rgba(18,44,120,0.65) 0%, transparent 46%)",
        "radial-gradient(ellipse at 84% 90%, rgba(10,26,80,0.48)  0%, transparent 50%)",
        "#040810",
      ].join(","),
      grid: [
        "repeating-linear-gradient(92deg,transparent,transparent 120px,rgba(80,130,220,0.020) 121px,rgba(80,130,220,0.020) 122px)",
        "repeating-linear-gradient(180deg,transparent,transparent 80px,rgba(80,130,220,0.008) 81px,rgba(80,130,220,0.008) 82px)",
      ].join(","),
    },
  };

  // ── Apply theme by name ────────────────────────────────────────────────────

  function applyTheme(name) {
    var theme = THEMES[name] || THEMES.dark;
    document.documentElement.setAttribute("data-theme", name);
    localStorage.setItem("levram-theme", name);

    var vars = Object.entries(theme.vars || {})
      .map(function(e) { return e[0] + ": " + e[1] + ";"; })
      .join("\n    ");

    var bodyRule = theme.body
      ? 'html[data-theme="' + name + '"] body { background: ' + theme.body + ' !important; }'
      : "";

    var gridRule = theme.grid
      ? 'html[data-theme="' + name + '"] body::before { background: ' + theme.grid + ' !important; }'
      : "";

    var extra = theme.extra || "";

    var css = [
      'html[data-theme="' + name + '"] {',
      "    " + vars,
      "}",
      bodyRule,
      gridRule,
      extra,
    ].join("\n");

    var el = document.getElementById("levram-theme-vars");
    if (!el) {
      el = document.createElement("style");
      el.id = "levram-theme-vars";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  // Apply immediately (blocks render — no flash)
  var saved = localStorage.getItem("levram-theme") || "dark";
  applyTheme(saved);

  // ── Public API ─────────────────────────────────────────────────────────────

  window.LEVRAM_THEMES = THEMES;

  window.setTheme = function (name) {
    applyTheme(name);
    _updateToggleLabel(name);
    _updatePickerSelection(name);
  };

  window.getTheme = function () {
    return localStorage.getItem("levram-theme") || "dark";
  };

  // ── Picker widget (injected on DOMContentLoaded) ───────────────────────────

  function _updateToggleLabel(name) {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var t = THEMES[name] || THEMES.dark;
    btn.innerHTML =
      '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
      t.accent + ';border:1px solid rgba(201,168,76,.5);margin-right:6px;vertical-align:middle;"></span>' +
      t.label;
  }

  function _updatePickerSelection(name) {
    var items = document.querySelectorAll("[data-theme-pick]");
    items.forEach(function (el) {
      var isActive = el.dataset.themePick === name;
      el.style.borderColor = isActive ? "rgba(201,168,76,0.8)" : "rgba(201,168,76,0.22)";
      el.style.background  = isActive ? "rgba(201,168,76,0.14)" : "transparent";
    });
  }

  function _buildPicker() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;

    // Update button label
    _updateToggleLabel(window.getTheme());

    // Create picker dropdown
    var picker = document.createElement("div");
    picker.id = "theme-picker";
    picker.style.cssText = [
      "position:fixed;z-index:9999;",
      "top:70px;right:10px;",
      "background:linear-gradient(180deg,#0d0c1e,#09080f);",
      "border:1px solid rgba(201,168,76,0.45);",
      "border-radius:6px;",
      "padding:10px;",
      "width:200px;",
      "box-shadow:0 8px 32px rgba(0,0,0,0.8),0 0 20px rgba(201,168,76,0.12);",
      "display:none;",
      "flex-direction:column;gap:6px;",
      "font-family:Rajdhani,sans-serif;",
    ].join("");

    var current = window.getTheme();
    Object.entries(THEMES).forEach(function (entry) {
      var key  = entry[0];
      var t    = entry[1];
      var item = document.createElement("div");
      item.setAttribute("data-theme-pick", key);
      item.style.cssText = [
        "display:flex;align-items:center;gap:10px;",
        "padding:8px 10px;border-radius:4px;cursor:pointer;",
        "border:1px solid " + (key === current ? "rgba(201,168,76,0.8)" : "rgba(201,168,76,0.22)") + ";",
        "background:" + (key === current ? "rgba(201,168,76,0.14)" : "transparent") + ";",
        "transition:all .2s;",
        "color:#f0eee8;font-size:15px;letter-spacing:1px;",
      ].join("");

      var sw = document.createElement("div");
      sw.style.cssText = [
        "width:22px;height:22px;border-radius:4px;flex-shrink:0;",
        "background:" + t.swatch + ";",
        "border:1px solid rgba(201,168,76,0.4);",
      ].join("");

      var lbl = document.createElement("span");
      lbl.textContent = t.label;

      item.appendChild(sw);
      item.appendChild(lbl);

      item.addEventListener("mouseenter", function () {
        if (item.getAttribute("data-theme-pick") !== window.getTheme()) {
          item.style.background = "rgba(201,168,76,0.08)";
        }
      });
      item.addEventListener("mouseleave", function () {
        if (item.getAttribute("data-theme-pick") !== window.getTheme()) {
          item.style.background = "transparent";
        }
      });
      item.addEventListener("click", function () {
        window.setTheme(key);
        picker.style.display = "none";
      });
      picker.appendChild(item);
    });

    document.body.appendChild(picker);

    // Toggle button opens/closes picker
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var shown = picker.style.display === "flex";
      picker.style.display = shown ? "none" : "flex";
      picker.style.flexDirection = "column";
    });

    // Click outside closes picker
    document.addEventListener("click", function () {
      picker.style.display = "none";
    });
    picker.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _buildPicker);
  } else {
    _buildPicker();
  }

})();

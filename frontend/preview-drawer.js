(function () {
  const previewBtn = document.querySelector('[data-ws="preview"]');
  const previewPanel = document.getElementById("ws-preview");

  if (!previewBtn || !previewPanel) return;

  previewBtn.type = "button";
  previewBtn.textContent = "▶  Preview Panel";

  let closeBtn = document.getElementById("preview-drawer-close");

  if (!closeBtn) {
    closeBtn = document.createElement("button");
    closeBtn.id = "preview-drawer-close";
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.title = "Close preview";
    closeBtn.className = "preview-drawer-close";

    const header = previewPanel.querySelector(".panel-header");
    if (header) header.appendChild(closeBtn);
  }

  function openPreviewDrawer() {
    document.body.classList.add("preview-drawer-open");
    previewBtn.classList.add("active");
  }

  function closePreviewDrawer() {
    document.body.classList.remove("preview-drawer-open");
    previewBtn.classList.remove("active");
  }

  previewBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (document.body.classList.contains("preview-drawer-open")) {
      closePreviewDrawer();
    } else {
      openPreviewDrawer();
    }
  }, true);

  closeBtn.addEventListener("click", closePreviewDrawer);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePreviewDrawer();
  });

  closePreviewDrawer();
})();

// ─── Preview Panel — Shot Context ─────────────────────────────
// Called by Shot Builder when a shot is loaded into the editor.
// Also callable from Timeline or anywhere a shot object is available.
window.pdUpdatePreview = function pdUpdatePreview(shot) {
  if (!shot) return;

  const BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

  // ── Meta bar ──────────────────────────────────────────────
  const set = (id, val, fallback = "—") => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || fallback;
  };
  set("meta-shot-num",  shot.shot_number || shot.sceneNum || shot.id);
  set("meta-char",      shot.character);
  set("meta-preset",    shot.voice_preset || shot.preset);
  set("meta-project",   shot.project);
  set("meta-keyframe-status", shot.renderOutputUrl ? "✔ Ready" : "Not generated");
  set("meta-clip-status",     shot.videoUrl || shot.clipUrl ? "✔ Animated" : (shot.renderOutputUrl ? "Static only" : "—"));

  // Update FX status without breaking voice lab's own updates
  if (!shot.fxUrl && !shot.rawUrl) {
    set("meta-fx-status", "No voice");
  }

  // ── Keyframe image ────────────────────────────────────────
  const imgEl = document.getElementById("preview-keyframe");
  const keyUrl = shot.renderOutputUrl || shot.renderOutputPath || "";
  if (imgEl) {
    if (keyUrl) {
      imgEl.src = keyUrl.startsWith("http") ? keyUrl : BASE + keyUrl;
      imgEl.style.display = "block";
    } else {
      imgEl.style.display = "none";
      imgEl.src = "";
    }
  }

  // ── Animated clip ─────────────────────────────────────────
  const vidEl = document.getElementById("preview-clip");
  const clipUrl = shot.videoUrl || shot.renderOutputUrl && shot.clipUrl || "";
  if (vidEl) {
    if (clipUrl) {
      vidEl.src = clipUrl.startsWith("http") ? clipUrl : BASE + clipUrl;
      vidEl.style.display = "block";
    } else {
      vidEl.style.display = "none";
      vidEl.src = "";
    }
  }

  // ── Shot text info ────────────────────────────────────────
  set("preview-shot-num",      shot.shot_number || shot.sceneNum || shot.id);
  set("preview-shot-desc",     shot.shotDesc || shot.shot_description);
  set("preview-shot-dialogue", shot.dialogue ? `"${shot.dialogue}"` : "");

  // ── Quick-action buttons ──────────────────────────────────
  const actEl = document.getElementById("preview-shot-actions");
  if (actEl) {
    const btnStyle = "font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:3px 10px;border-radius:2px;cursor:pointer;border:1px solid;font-family:Rajdhani,sans-serif;";
    const actions = [];

    if (keyUrl) {
      actions.push(
        `<button style="${btnStyle}color:#88dd88;background:rgba(0,60,0,0.4);border-color:rgba(100,200,100,0.4);"
          onclick="window.showTab&&showTab('image-gen');window.igLoadCharacterImage&&igLoadCharacterImage('${keyUrl}','${shot.shot_number||shot.id}','','')">
          Animate ↗
        </button>`
      );
    }
    if (shot.fxUrl || shot.rawUrl) {
      const audioUrl = (shot.fxUrl || shot.rawUrl);
      actions.push(
        `<audio controls src="${audioUrl.startsWith("http") ? audioUrl : BASE + audioUrl}"
          style="height:24px;width:120px;accent-color:var(--gold);vertical-align:middle;"></audio>`
      );
    }

    actEl.innerHTML = actions.join("");
  }

  // ── Show the media row if we have anything to display ────
  const mediaRow = document.getElementById("preview-media-row");
  if (mediaRow) {
    const hasContent = keyUrl || clipUrl || shot.shotDesc || shot.dialogue;
    mediaRow.style.display = hasContent ? "block" : "none";
  }

  // Auto-open preview drawer when a shot loads
  document.body.classList.add("preview-drawer-open");
  const previewBtn = document.querySelector('[data-ws="preview"]');
  if (previewBtn) previewBtn.classList.add("active");
};

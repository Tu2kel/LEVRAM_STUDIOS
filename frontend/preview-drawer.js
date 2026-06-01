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

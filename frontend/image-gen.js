// ─── Image Gen (Phase 9) ──────────────────────────────────
const IG_BASE = "http://localhost:8000";

const IG_ENGINE_HINTS = {
  dalle3:   "Uses your OpenAI key — best prompt accuracy.",
  fal_flux: "Needs FAL_KEY in .env (sign up at fal.ai). Best photorealism.",
  comfy:    "Requires ComfyUI running at localhost:8188.",
};

let igActiveEngine = localStorage.getItem("ig-engine") || "dalle3";

// ─── Engine toggle ────────────────────────────────────────
function igInitEngineToggle() {
  const toggle = document.getElementById("ig-engine-toggle");
  if (!toggle) return;

  toggle.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    if (btn.dataset.engine === igActiveEngine) btn.classList.add("active");
    else btn.classList.remove("active");

    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      igActiveEngine = btn.dataset.engine;
      localStorage.setItem("ig-engine", igActiveEngine);
      const hint = document.getElementById("ig-engine-hint");
      if (hint) hint.textContent = IG_ENGINE_HINTS[igActiveEngine] || "";
    });
  });

  const hint = document.getElementById("ig-engine-hint");
  if (hint) hint.textContent = IG_ENGINE_HINTS[igActiveEngine] || "";
}

// ─── Character select ─────────────────────────────────────
async function igLoadCharacters() {
  const sel = document.getElementById("ig-character");
  if (!sel) return;
  try {
    const res  = await fetch(`${IG_BASE}/characters`);
    const data = await res.json();
    const chars = data.characters || [];
    sel.innerHTML = '<option value="">None / Standalone</option>' +
      chars.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  } catch (err) {
    console.error("IG CHAR LOAD ERROR:", err);
  }
}

// ─── Generate ─────────────────────────────────────────────
async function igGenerate() {
  const prompt    = document.getElementById("ig-prompt")?.value.trim() || "";
  const character = document.getElementById("ig-character")?.value || "";
  const style     = document.getElementById("ig-style")?.value || "cinematic photorealistic";
  const aspect    = document.getElementById("ig-aspect")?.value || "widescreen";
  const statusEl  = document.getElementById("ig-status");
  const btn       = document.getElementById("ig-generate-btn");

  if (!prompt) {
    if (statusEl) statusEl.textContent = "Enter a prompt first.";
    return;
  }

  const engineLabel = { dalle3: "DALL-E 3", fal_flux: "fal.ai FLUX", comfy: "ComfyUI" }[igActiveEngine] || igActiveEngine;
  if (statusEl) statusEl.textContent = `Generating via ${engineLabel}…`;
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

  try {
    const res = await fetch(`${IG_BASE}/image-gen/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, character, style, aspect, engine: igActiveEngine }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Generation failed");

    const imgUrl    = IG_BASE + data.imageUrl;
    const resultBox = document.getElementById("ig-result");
    const resultImg = document.getElementById("ig-result-img");
    const dlLink    = document.getElementById("ig-download");

    if (resultBox) resultBox.style.display = "block";
    if (resultImg) resultImg.src = imgUrl;
    if (dlLink)    { dlLink.href = imgUrl; dlLink.download = data.imageUrl?.split("/").pop() || "levram_image.png"; }

    if (statusEl) statusEl.textContent = `Done — ${engineLabel}`;
    await igLoadGallery();

  } catch (err) {
    console.error("IG GENERATE ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "Generation failed.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate Image"; }
  }
}

// ─── Gallery ──────────────────────────────────────────────
async function igLoadGallery() {
  const gallery = document.getElementById("ig-gallery");
  if (!gallery) return;

  try {
    const res    = await fetch(`${IG_BASE}/image-gen/gallery`);
    const data   = await res.json();
    const images = data.images || [];

    if (!images.length) {
      gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;grid-column:1/-1;">No images yet.</div>`;
      return;
    }

    const engineBadge = { dalle3: "D3", flux: "FX", levram: "CQ" };

    gallery.innerHTML = images.map(img => `
      <div class="ig-thumb" onclick="igOpenLightbox('${IG_BASE + img.url}')">
        <img src="${IG_BASE + img.url}" loading="lazy" alt="${img.filename}" />
        <div class="ig-thumb-meta">${img.created}</div>
      </div>
    `).join("");
  } catch (err) {
    console.error("IG GALLERY ERROR:", err);
    if (gallery) gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;grid-column:1/-1;">Could not load gallery.</div>`;
  }
}

// ─── Lightbox ─────────────────────────────────────────────
function igOpenLightbox(url) {
  const lb    = document.getElementById("ig-lightbox");
  const lbImg = document.getElementById("ig-lightbox-img");
  if (!lb || !lbImg) return;
  lbImg.src = url;
  lb.style.display = "flex";
}

function igCloseLightbox(e) {
  if (e && e.target !== e.currentTarget && !e.target.closest("button")) return;
  const lb = document.getElementById("ig-lightbox");
  if (lb) lb.style.display = "none";
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") igCloseLightbox();
});

window.igOpenLightbox   = igOpenLightbox;
window.igCloseLightbox  = igCloseLightbox;

// ─── Init ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  igInitEngineToggle();
  document.getElementById("ig-generate-btn")?.addEventListener("click", igGenerate);
  igLoadCharacters();
  igLoadGallery();
});

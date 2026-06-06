// ─── Image Gen (Phase 9) ──────────────────────────────────
const IG_BASE = "http://localhost:8000";

async function igLoadCharacters() {
  const sel = document.getElementById("ig-character");
  if (!sel) return;

  try {
    const res  = await fetch(`${IG_BASE}/characters`);
    const data = await res.json();
    const chars = data.characters || [];

    const existing = sel.innerHTML;
    sel.innerHTML = '<option value="">None / Standalone</option>' +
      chars.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  } catch (err) {
    console.error("IG CHAR LOAD ERROR:", err);
  }
}

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

  if (statusEl) statusEl.textContent = "Generating... (ComfyUI may take up to 2 minutes)";
  if (btn) { btn.disabled = true; btn.textContent = "Generating..."; }

  try {
    const res = await fetch(`${IG_BASE}/image-gen/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, character, style, aspect }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || "Generation failed");
    }

    const imgUrl = IG_BASE + data.imageUrl;

    const resultBox = document.getElementById("ig-result");
    const resultImg = document.getElementById("ig-result-img");
    const dlLink    = document.getElementById("ig-download");

    if (resultBox) resultBox.style.display = "block";
    if (resultImg) resultImg.src = imgUrl;
    if (dlLink)   { dlLink.href = imgUrl; dlLink.download = data.imageUrl?.split("/").pop() || "levram_image.png"; }

    if (statusEl) statusEl.textContent = "Image generated.";

    // Refresh gallery
    await igLoadGallery();

  } catch (err) {
    console.error("IG GENERATE ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "Generation failed.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate Image"; }
  }
}

async function igLoadGallery() {
  const gallery = document.getElementById("ig-gallery");
  if (!gallery) return;

  try {
    const res  = await fetch(`${IG_BASE}/image-gen/gallery`);
    const data = await res.json();
    const images = data.images || [];

    if (!images.length) {
      gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;grid-column:1/-1;">No images yet.</div>`;
      return;
    }

    gallery.innerHTML = images.map(img => `
      <div style="position:relative;cursor:pointer;" onclick="igSelectGalleryImage('${IG_BASE + img.url}', '${img.filename}')">
        <img src="${IG_BASE + img.url}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border:1px solid var(--border);border-radius:2px;display:block;" loading="lazy" alt="${img.filename}" />
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.65);font-size:8px;letter-spacing:1px;padding:2px 4px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${img.created}</div>
      </div>
    `).join("");
  } catch (err) {
    console.error("IG GALLERY ERROR:", err);
    if (gallery) gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;grid-column:1/-1;">Could not load gallery.</div>`;
  }
}

function igSelectGalleryImage(url, filename) {
  const resultBox = document.getElementById("ig-result");
  const resultImg = document.getElementById("ig-result-img");
  const dlLink    = document.getElementById("ig-download");

  if (resultBox) resultBox.style.display = "block";
  if (resultImg) resultImg.src = url;
  if (dlLink)    { dlLink.href = url; dlLink.download = filename; }

  resultImg?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

window.igSelectGalleryImage = igSelectGalleryImage;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("ig-generate-btn")?.addEventListener("click", igGenerate);
  igLoadCharacters();
  igLoadGallery();
});

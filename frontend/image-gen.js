// ─── Image & Video Gen (Phase 9/10) ──────────────────────
const IG_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

const IG_ENGINE_HINTS = {
  dalle3:   "Uses your OpenAI key — best prompt accuracy.",
  fal_flux: "Needs FAL_KEY in .env (sign up at fal.ai). Best photorealism.",
  comfy:    "Requires ComfyUI running at localhost:8188.",
};

const IG_VIDEO_ENGINE_HINTS = {
  wan:    "Wan2.1 1.3B T2V via ComfyUI. Generates ~5s clips. Free.",
  kling:  "Kling 2.0 — requires paid API key.",
  runway: "Runway Gen-4 — requires paid API key.",
};

let igActiveEngine      = localStorage.getItem("ig-engine")       || "dalle3";
let igActiveVideoEngine = localStorage.getItem("ig-video-engine")  || "wan";
let igActiveMode        = localStorage.getItem("ig-mode")          || "image";

// ─── Mode toggle (Image / Video) ─────────────────────────
function igInitModeToggle() {
  const toggle = document.getElementById("ig-mode-toggle");
  if (!toggle) return;

  toggle.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === igActiveMode);
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      igActiveMode = btn.dataset.mode;
      localStorage.setItem("ig-mode", igActiveMode);
      igApplyMode();
    });
  });

  igApplyMode();
}

function igApplyMode() {
  const imageSection = document.getElementById("ig-image-section");
  const videoSection = document.getElementById("ig-video-section");
  const styleGroup   = document.getElementById("ig-style-group");
  const genBtn       = document.getElementById("ig-generate-btn");
  const videoGallery = document.getElementById("ig-video-gallery-section");

  if (igActiveMode === "video") {
    if (imageSection) imageSection.style.display = "none";
    if (videoSection) videoSection.style.display = "block";
    if (styleGroup)   styleGroup.style.display   = "none";
    if (genBtn)       genBtn.textContent = "Generate Video";
    if (videoGallery) videoGallery.style.display  = "block";
    igLoadVideoGallery();
  } else {
    if (imageSection) imageSection.style.display = "block";
    if (videoSection) videoSection.style.display = "none";
    if (styleGroup)   styleGroup.style.display   = "block";
    if (genBtn)       genBtn.textContent = "Generate Image";
    if (videoGallery) videoGallery.style.display  = "none";
  }
}

// ─── Engine toggles ───────────────────────────────────────
function igInitEngineToggle() {
  const toggle = document.getElementById("ig-engine-toggle");
  if (!toggle) return;

  toggle.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.engine === igActiveEngine);
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

function igInitVideoEngineToggle() {
  const toggle = document.getElementById("ig-video-engine-toggle");
  if (!toggle) return;

  toggle.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vengine === igActiveVideoEngine);
    btn.addEventListener("click", () => {
      if (btn.style.opacity === "0.45") {
        alert("This video engine requires a paid API key. Set it in .env and re-enable.");
        return;
      }
      toggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      igActiveVideoEngine = btn.dataset.vengine;
      localStorage.setItem("ig-video-engine", igActiveVideoEngine);
      const hint = document.getElementById("ig-video-engine-hint");
      if (hint) hint.textContent = IG_VIDEO_ENGINE_HINTS[igActiveVideoEngine] || "";
    });
  });

  const hint = document.getElementById("ig-video-engine-hint");
  if (hint) hint.textContent = IG_VIDEO_ENGINE_HINTS[igActiveVideoEngine] || "";
}

// ─── Character select ─────────────────────────────────────
async function igLoadCharacters() {
  const sel = document.getElementById("ig-character");
  if (!sel) return;
  try {
    const res  = await levFetch(`${IG_BASE}/characters`);
    const data = await res.json();
    const chars = data.characters || [];
    sel.innerHTML = '<option value="">None / Standalone</option>' +
      chars.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  } catch (err) {
    console.error("IG CHAR LOAD ERROR:", err);
  }
}

// ─── Generate dispatcher ──────────────────────────────────
async function igGenerate() {
  if (igActiveMode === "video") {
    await igGenerateVideo();
  } else {
    await igGenerateImage();
  }
}

// ─── Generate Image ────────────────────────────────────────
async function igGenerateImage() {
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
    const res = await levFetch(`${IG_BASE}/image-gen/generate`, {
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
    const videoRes  = document.getElementById("ig-video-result");

    if (videoRes) videoRes.style.display = "none";
    igCurrentImageUrl = data.imageUrl;
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

// ─── Generate Video (Wan2.1) ──────────────────────────────
async function igGenerateVideo() {
  const prompt    = document.getElementById("ig-prompt")?.value.trim() || "";
  const character = document.getElementById("ig-character")?.value || "";
  const aspect    = document.getElementById("ig-aspect")?.value || "widescreen";
  const steps     = parseInt(document.getElementById("ig-wan-steps")?.value || "25");
  const cfg       = parseFloat(document.getElementById("ig-wan-cfg")?.value || "6");
  const seedRaw   = document.getElementById("ig-wan-seed")?.value.trim();
  const seed      = seedRaw ? parseInt(seedRaw) : null;
  const statusEl  = document.getElementById("ig-status");
  const btn       = document.getElementById("ig-generate-btn");

  if (!prompt) {
    if (statusEl) statusEl.textContent = "Enter a prompt first.";
    return;
  }

  if (igActiveVideoEngine !== "wan") {
    if (statusEl) statusEl.textContent = "Paid video engines not yet enabled. Use Wan2.1.";
    return;
  }

  if (statusEl) statusEl.textContent = "Generating Wan2.1 video… this can take 3-12 min.";
  if (btn) { btn.disabled = true; btn.textContent = "Generating Video…"; }

  try {
    const res = await levFetch(`${IG_BASE}/video/generate-wan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, character, aspect, steps, cfg, seed }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Video generation failed");

    const videoUrl    = IG_BASE + data.outputUrl;
    const resultBox   = document.getElementById("ig-result");
    const videoResult = document.getElementById("ig-video-result");
    const videoPlayer = document.getElementById("ig-video-player");
    const videoDl     = document.getElementById("ig-video-download");

    if (resultBox)   resultBox.style.display   = "none";
    if (videoResult) videoResult.style.display  = "block";
    if (videoPlayer) videoPlayer.src = videoUrl;
    if (videoDl)     { videoDl.href = videoUrl; videoDl.download = data.outputUrl?.split("/").pop() || "levram_video.mp4"; }

    if (statusEl) statusEl.textContent = `Video ready — ${data.frames} frames @ ${data.fps}fps`;
    await igLoadVideoGallery();

  } catch (err) {
    console.error("IG VIDEO GENERATE ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "Video generation failed.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
  }
}

// ─── Image Gallery ─────────────────────────────────────────
async function igLoadGallery() {
  const gallery = document.getElementById("ig-gallery");
  if (!gallery) return;

  try {
    const res    = await levFetch(`${IG_BASE}/image-gen/gallery`);
    const data   = await res.json();
    const images = data.images || [];

    if (!images.length) {
      gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;grid-column:1/-1;">No images yet.</div>`;
      return;
    }

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

// ─── Video Gallery ─────────────────────────────────────────
async function igLoadVideoGallery() {
  const gallery = document.getElementById("ig-video-gallery");
  if (!gallery) return;

  try {
    const res  = await levFetch(`${IG_BASE}/video/library`);
    const data = await res.json();
    const vids = data.videos || [];

    if (!vids.length) {
      gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No videos yet.</div>`;
      return;
    }

    gallery.innerHTML = vids.map(v => `
      <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:8px;">
        <video src="${IG_BASE + v.url}" controls style="width:100%;border-radius:2px;max-height:180px;background:#000;"></video>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <span style="font-size:10px;color:var(--text-dim);letter-spacing:1px;">${v.created} · ${v.size_mb}MB</span>
          <a href="${IG_BASE + v.url}" download="${v.name}" style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);text-decoration:none;border:1px solid rgba(201,168,76,0.3);padding:3px 8px;border-radius:2px;">DL</a>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("IG VIDEO GALLERY ERROR:", err);
    if (gallery) gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;">Could not load videos.</div>`;
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

// ─── Upscale current image ────────────────────────────────
let igCurrentImageUrl = null;  // tracks last generated image URL path

async function igUpscale() {
  if (!igCurrentImageUrl) {
    const statusEl = document.getElementById("ig-status");
    if (statusEl) statusEl.textContent = "Generate an image first.";
    return;
  }
  const btn      = document.getElementById("ig-upscale-btn");
  const statusEl = document.getElementById("ig-status");
  const resultImg= document.getElementById("ig-result-img");
  if (btn) { btn.disabled = true; btn.textContent = "Upscaling…"; }
  if (statusEl) statusEl.textContent = "Upscaling via RealESRGAN / PIL…";

  try {
    const res = await levFetch(`${IG_BASE}/upscale/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: igCurrentImageUrl, scale: 4 }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Upscale failed");

    const upUrl = IG_BASE + data.imageUrl;
    if (resultImg) resultImg.src = upUrl;
    const dlLink = document.getElementById("ig-download");
    if (dlLink) { dlLink.href = upUrl; dlLink.download = data.imageUrl.split("/").pop(); }
    igCurrentImageUrl = data.imageUrl;
    if (statusEl) statusEl.textContent = `Upscaled ×${data.scale} via ${data.engine}`;
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Upscale ×4"; }
  }
}
window.igUpscale = igUpscale;

// ─── Animate (Image-to-Video) ─────────────────────────────
function igAnimateImage() {
  if (!igCurrentImageUrl) {
    const s = document.getElementById("ig-status");
    if (s) s.textContent = "Generate an image first.";
    return;
  }
  const panel = document.getElementById("ig-i2v-panel");
  if (panel) panel.style.display = panel.style.display === "none" ? "block" : "none";
}

async function igRunI2V() {
  if (!igCurrentImageUrl) return;
  const model    = document.getElementById("ig-i2v-model")?.value    || "wan21_i2v";
  const prompt   = document.getElementById("ig-i2v-prompt")?.value   || "";
  const duration = parseInt(document.getElementById("ig-i2v-duration")?.value || "5");
  const statusEl = document.getElementById("ig-i2v-status");
  const btn      = document.getElementById("ig-i2v-go-btn");

  const modelLabels = {
    wan21_i2v:     "Wan 2.1 1.3B",
    wan21_14b_i2v: "Wan 2.1 14B",
    hunyuan_i2v:   "HunyuanVideo",
  };
  if (statusEl) statusEl.textContent = `Animating via ${modelLabels[model] || model} — takes 3–10 min…`;
  if (btn) { btn.disabled = true; btn.textContent = "Animating…"; }

  try {
    const res = await levFetch(`${IG_BASE}/video/image-to-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: igCurrentImageUrl, prompt, model, duration }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "I2V failed");

    const videoUrl    = IG_BASE + data.outputUrl;
    const videoResult = document.getElementById("ig-video-result");
    const videoPlayer = document.getElementById("ig-video-player");
    const videoDl     = document.getElementById("ig-video-download");
    const resultBox   = document.getElementById("ig-result");
    const i2vPanel    = document.getElementById("ig-i2v-panel");

    if (i2vPanel)    i2vPanel.style.display   = "none";
    if (resultBox)   resultBox.style.display   = "none";
    if (videoResult) videoResult.style.display = "block";
    if (videoPlayer) videoPlayer.src = videoUrl;
    if (videoDl)     { videoDl.href = videoUrl; videoDl.download = data.outputUrl?.split("/").pop() || "levram_i2v.mp4"; }

    if (statusEl) statusEl.textContent = `Video ready — ${modelLabels[model] || model}`;
    await igLoadVideoGallery();

  } catch (err) {
    console.error("IG I2V ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "I2V failed.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
  }
}

window.igAnimateImage = igAnimateImage;
window.igRunI2V       = igRunI2V;

// ─── Voice Lab inject (from Story Engine) ────────────────
(function checkVoiceInject() {
  const raw = localStorage.getItem("levram-voice-inject");
  if (!raw) return;
  try {
    const { text, character } = JSON.parse(raw);
    const scriptEl = document.getElementById("script-input");
    const charSel  = document.getElementById("voice-char-select");
    if (scriptEl) scriptEl.value = text;
    if (charSel && character) {
      const opt = [...charSel.options].find(o => o.value === character);
      if (opt) charSel.value = character;
    }
    localStorage.removeItem("levram-voice-inject");
  } catch {}
})();

// ─── Init ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  igInitModeToggle();
  igInitEngineToggle();
  igInitVideoEngineToggle();
  document.getElementById("ig-generate-btn")?.addEventListener("click", igGenerate);
  igLoadCharacters();
  igLoadGallery();
});

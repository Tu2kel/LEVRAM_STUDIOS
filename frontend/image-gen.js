// ─── Image & Video Gen (Phase 9/10) ──────────────────────
const IG_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

const IG_ENGINE_HINTS = {
  dalle3:               "Uses your OpenAI key — best prompt accuracy.",
  fal_flux:             "fal.ai FLUX Dev — photorealism.",
  comfy:                "Requires ComfyUI running at localhost:8188.",
  consistent_character: "★ BEST FOR CHARACTERS — Load 1 face photo in Person 1, describe the scene. Same character every generation.",
  ws_flux_uncensored:   "🔴 WaveSpeed Flux Uncensored — pay per generation, no content restrictions.",
  venice_flux:          "🔴 Venice.ai — uncensored SD3.5. Free tier: 15/day (blurred). Pro $18/mo: 1,000/day. Requires VENICE_API_KEY.",
};

const IG_VIDEO_ENGINE_HINTS = {
  wan:           "Wan 2.1 1.3B — local ComfyUI. Free, requires ComfyUI running.",
  wan21:         "Wan 2.1 1.3B — fal.ai cloud. Free, fast, ~3 min.",
  wan21_14b:     "Wan 2.1 14B — fal.ai cloud. Free, best open-source quality, ~8 min.",
  wan21:         "Wan 2.1 — fal.ai cloud. Free, fast, solid motion, ~3 min.",
  cogvideox:     "CogVideoX 5B — fal.ai cloud. Free, cinematic style, ~5 min.",
  runway_gen4:   "Runway Gen-4.5 ✦ — fal.ai cloud. Paid per clip. T2V + I2V. Highest quality.",
};

let igActiveEngine      = localStorage.getItem("ig-engine")       || "dalle3";
let igActiveVideoEngine = localStorage.getItem("ig-video-engine")  || "wan";
let igActiveMode        = localStorage.getItem("ig-mode")          || "image";
let igRefImages         = []; // [{ base64, mediaType, preview }]
let igFaceRefs1 = []; // Person 1 face photos
let igFaceRefs2 = []; // Person 2 face photos

// ─── Face reference helpers ───────────────────────────────
function igHandleFaceDrop(e, person) {
  e.preventDefault();
  const el = document.getElementById(`ig-face-drop-${person}`);
  const def = person === 1 ? "rgba(201,168,76,0.2)" : "rgba(201,168,76,0.12)";
  if (el) el.style.borderColor = def;
  igAddFaceRefs(e.dataTransfer.files, person);
}

function igAddFaceRefs(files, person) {
  const arr = person === 1 ? igFaceRefs1 : igFaceRefs2;
  [...files].forEach(file => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const [header, base64] = dataUrl.split(",");
      const mediaType = (header.match(/data:(.*);/) || [])[1] || "image/jpeg";
      arr.push({ base64, mediaType, preview: dataUrl });
      igRenderFaceThumbs(person);
    };
    reader.readAsDataURL(file);
  });
}

function igRemoveFaceRef(person, idx) {
  if (person === 1) igFaceRefs1.splice(idx, 1);
  else              igFaceRefs2.splice(idx, 1);
  igRenderFaceThumbs(person);
}

function igRenderFaceThumbs(person) {
  const arr = person === 1 ? igFaceRefs1 : igFaceRefs2;
  const box = document.getElementById(`ig-face-thumbs-${person}`);
  if (!box) return;
  box.innerHTML = arr.map((img, i) => `
    <div style="position:relative;width:52px;height:52px;">
      <img src="${img.preview}" style="width:52px;height:52px;object-fit:cover;border-radius:3px;border:1px solid rgba(201,168,76,0.4);" />
      <button onclick="igRemoveFaceRef(${person},${i})" style="position:absolute;top:-5px;right:-5px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">✕</button>
    </div>`).join("");
}

// ─── Scene reference photo helpers ───────────────────────
function igHandleRefDrop(e) {
  e.preventDefault();
  const el = document.getElementById("ig-ref-drop");
  if (el) el.style.borderColor = "rgba(201,168,76,0.25)";
  igAddRefImages(e.dataTransfer.files);
}

function igAddRefImages(files) {
  [...files].forEach(file => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const [header, base64] = dataUrl.split(",");
      const mediaType = (header.match(/data:(.*);/) || [])[1] || "image/jpeg";
      igRefImages.push({ base64, mediaType, preview: dataUrl });
      igRenderRefThumbs();
    };
    reader.readAsDataURL(file);
  });
}

function igRemoveRef(idx) {
  igRefImages.splice(idx, 1);
  igRenderRefThumbs();
}

function igRenderRefThumbs() {
  const box = document.getElementById("ig-ref-thumbs");
  if (!box) return;
  box.innerHTML = igRefImages.map((img, i) => `
    <div style="position:relative;width:56px;height:56px;">
      <img src="${img.preview}" style="width:56px;height:56px;object-fit:cover;border-radius:3px;border:1px solid rgba(201,168,76,0.3);" />
      <button onclick="igRemoveRef(${i})" style="position:absolute;top:-5px;right:-5px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">✕</button>
    </div>`).join("");
}

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

  // Default to wan21 if stored value is a stale/unknown key
  const knownEngines = ["wan", "wan21", "wan21_14b", "runway_gen4"];
  if (!knownEngines.includes(igActiveVideoEngine)) {
    igActiveVideoEngine = "wan21";
    localStorage.setItem("ig-video-engine", igActiveVideoEngine);
  }

  function applyVideoEngine(engine) {
    toggle.querySelectorAll(".cl-vtoggle-btn").forEach(b => b.classList.remove("active"));
    const active = toggle.querySelector(`[data-vengine="${engine}"]`);
    if (active) active.classList.add("active");
    const hint = document.getElementById("ig-video-engine-hint");
    if (hint) hint.textContent = IG_VIDEO_ENGINE_HINTS[engine] || "";
    const localControls = document.getElementById("ig-wan-local-controls");
    if (localControls) localControls.style.display = engine === "wan" ? "block" : "none";
  }

  toggle.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      igActiveVideoEngine = btn.dataset.vengine;
      localStorage.setItem("ig-video-engine", igActiveVideoEngine);
      applyVideoEngine(igActiveVideoEngine);
    });
  });

  applyVideoEngine(igActiveVideoEngine);
}

// ─── Character select ─────────────────────────────────────
let igCharacterCache = [];

window.igAddToCharRef = async function igAddToCharRef(imageUrl, btn) {
  const charSel = document.getElementById("ig-character");
  const charId  = charSel?.value;
  const charName = charSel?.selectedOptions?.[0]?.dataset?.name || charSel?.selectedOptions?.[0]?.textContent || "character";
  if (!charId) {
    levShowError("Select a character first from the CHARACTER dropdown.");
    return;
  }
  if (btn) { btn.textContent = "Saving…"; btn.style.background = "rgba(201,168,76,0.85)"; }
  try {
    const res = await levFetch(`${IG_BASE}/characters/${charId}/add-reference-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.detail || "Failed");
    if (btn) { btn.textContent = `✓ Added to ${charName}`; btn.style.background = "rgba(80,180,80,0.9)"; }
    // Reload character images in IG if that character is still selected
    if (typeof igLoadCharacterFaceRefs === "function") igLoadCharacterFaceRefs(charId, 1);
    if (typeof loadCharacters === "function") loadCharacters();
  } catch (err) {
    if (btn) { btn.textContent = "Failed"; btn.style.background = "rgba(200,50,50,0.85)"; }
    levShowError(`Char Ref failed: ${err.message}`);
  }
};

async function igLoadCharacters() {
  const sel = document.getElementById("ig-character");
  if (!sel) return;
  try {
    const res  = await levFetch(`${IG_BASE}/characters`);
    const data = await res.json();
    igCharacterCache = data.characters || [];
    const opts = '<option value="">None / Standalone</option>' +
      igCharacterCache.map(c => `<option value="${c.id}" data-name="${c.name}">${c.name}${c.lora_status === "ready" ? " ★" : ""}</option>`).join("");
    sel.innerHTML = opts;
    // Populate Person 1 / Person 2 character pickers
    const pickerOpts = '<option value="">From Character…</option>' +
      igCharacterCache.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    const p1 = document.getElementById("ig-char-pick-1");
    const p2 = document.getElementById("ig-char-pick-2");
    if (p1) p1.innerHTML = pickerOpts;
    if (p2) p2.innerHTML = pickerOpts;
  } catch (err) {
    console.error("IG CHAR LOAD ERROR:", err);
  }
}

// Load a character's reference images into a face slot
window.igLoadCharacterFaceRefs = async function(charId, person) {
  if (!charId) return;
  const char = igCharacterCache.find(c => c.id === charId);
  if (!char) return;
  const refs = char.reference_images || [];
  if (!refs.length) {
    levShowError(`${char.name} has no reference photos uploaded yet.`);
    return;
  }
  const thumbEl = document.getElementById(`ig-face-thumbs-${person}`);
  if (thumbEl) thumbEl.innerHTML = `<div style="font-size:10px;color:var(--gold);letter-spacing:1px;">Loading ${refs.length} refs from ${char.name}…</div>`;
  // Fetch each ref image as base64 and add to face slot
  const slot = person === 1 ? igFaceRefs1 : igFaceRefs2;
  slot.length = 0;
  for (const url of refs.slice(0, 5)) {
    try {
      const fullUrl = url.startsWith("http") ? url : IG_BASE + url;
      const r = await fetch(fullUrl);
      const blob = await r.blob();
      await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
          const b64 = e.target.result.split(",")[1];
          slot.push({ base64: b64, mediaType: blob.type || "image/jpeg" });
          resolve();
        };
        reader.readAsDataURL(blob);
      });
    } catch (_) {}
  }
  igRenderFaceThumbs(person);
};

function igRenderCharacterImages(charId) {
  const row = document.getElementById("ig-char-images-row");
  if (!row) return;
  if (!charId) { row.innerHTML = ""; row.style.display = "none"; return; }
  const char   = igCharacterCache.find(c => c.id === charId);
  const images = char?.preview_images || [];
  if (images.length === 0) { row.innerHTML = ""; row.style.display = "none"; return; }
  const activeIdx = char.active_preview_index ?? 0;
  row.style.display = "flex";
  row.innerHTML = images.map((img, i) => {
    const displayUrl = img.url.startsWith("http") ? img.url : IG_BASE + img.url;
    const relUrl     = img.url.startsWith("/") ? img.url : "/" + img.url;
    const label      = (img.label || `Look ${i + 1}`).replace(/'/g, "\\'");
    const isActive   = i === activeIdx;
    return `<div onclick="igLoadCharacterImage('${relUrl}','${label}','${charId}',${i})"
      title="${label}" style="cursor:pointer;text-align:center;flex-shrink:0;">
      <img src="${displayUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:3px;
        border:2px solid ${isActive ? "var(--gold)" : "rgba(255,255,255,0.12)"};" />
      <div style="font-size:9px;color:${isActive ? "var(--gold)" : "var(--text-dim)"};letter-spacing:1px;
        text-transform:uppercase;margin-top:2px;width:64px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${img.label || `Look ${i + 1}`}</div>
    </div>`;
  }).join("");
}

function igAutoFillCharPrompt(charId) {
  const promptEl  = document.getElementById("ig-prompt");
  const noticeEl  = document.getElementById("ig-char-prompt-notice");
  if (!promptEl) return;

  if (!charId) {
    // Cleared selection — remove notice, leave prompt alone
    if (noticeEl) noticeEl.style.display = "none";
    return;
  }

  const char = igCharacterCache.find(c => c.id === charId);
  if (!char) return;

  // Only auto-fill if prompt is empty or was previously auto-filled from a character
  const wasAutofilled = promptEl.dataset.autofilled === "1";
  if (promptEl.value.trim() && !wasAutofilled) {
    if (noticeEl) {
      noticeEl.textContent = `✦ ${char.name}'s bio ready — clear prompt to auto-fill`;
      noticeEl.style.display = "block";
    }
    return;
  }

  // Build portrait prompt from character bio fields
  const parts = [];
  if (char.name)        parts.push(`Portrait of ${char.name}`);
  if (char.gender && char.age) parts.push(`${char.gender}, ${char.age} years old`);
  else if (char.gender) parts.push(char.gender);
  if (char.appearance)  parts.push(char.appearance);
  if (char.wardrobe)    parts.push(`Wearing ${char.wardrobe}`);
  if (char.personality) parts.push(char.personality);
  parts.push("Cinematic photorealistic portrait, dramatic lighting, sharp detail, high quality");

  const builtPrompt = parts.join(". ");
  promptEl.value = builtPrompt;
  promptEl.dataset.autofilled = "1";
  promptEl.dispatchEvent(new Event("input", { bubbles: true }));

  if (noticeEl) {
    noticeEl.textContent = `✦ Prompt auto-filled from ${char.name}'s character bio`;
    noticeEl.style.display = "block";
  }
}

window.igLoadCharacterImage = function igLoadCharacterImage(relUrl, label, charId, idx) {
  const char = igCharacterCache.find(c => c.id === charId);
  if (char) { char.active_preview_index = idx; igRenderCharacterImages(charId); }
  const fullUrl = relUrl.startsWith("http") ? relUrl : IG_BASE + relUrl;
  igCurrentImageUrl = relUrl;
  const resultBox = document.getElementById("ig-result");
  const resultImg = document.getElementById("ig-result-img");
  const i2vPanel  = document.getElementById("ig-i2v-panel");
  const dlLink    = document.getElementById("ig-download");
  const statusEl  = document.getElementById("ig-status");
  if (resultImg) resultImg.src = fullUrl;
  if (resultBox) resultBox.style.display = "block";
  if (i2vPanel)  i2vPanel.style.display  = "block";
  if (dlLink)    { dlLink.href = fullUrl; dlLink.download = relUrl.split("/").pop(); }
  if (statusEl)  statusEl.textContent = `Loaded: ${label} — ready to animate`;
  resultBox?.scrollIntoView({ behavior: "smooth", block: "start" });
};

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
  const prompt       = document.getElementById("ig-prompt")?.value.trim() || "";
  const charSel      = document.getElementById("ig-character");
  const character_id = charSel?.value || "";
  const character    = charSel?.selectedOptions[0]?.dataset.name || "";
  const style        = document.getElementById("ig-style")?.value || "cinematic photorealistic";
  const aspect       = document.getElementById("ig-aspect")?.value || "widescreen";
  const statusEl  = document.getElementById("ig-status");
  const btn       = document.getElementById("ig-generate-btn");

  if (!prompt) {
    if (statusEl) statusEl.textContent = "Enter a prompt first.";
    return;
  }

  const engineLabel = { dalle3: "DALL-E 3", fal_flux: "fal.ai FLUX", comfy: "ComfyUI" }[igActiveEngine] || igActiveEngine;
  if (statusEl) statusEl.textContent = `Generating via ${engineLabel}…`;
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; btn.classList.add("lora-scanning"); }

  try {
    const refPayload   = igRefImages.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
    const facePayload1 = igFaceRefs1.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
    const facePayload2 = igFaceRefs2.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
    const res = await levFetch(`${IG_BASE}/image-gen/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt, character, character_id, style, aspect, engine: igActiveEngine,
        reference_images:   refPayload,
        face_references_1:  facePayload1,
        face_references_2:  facePayload2,
      }),
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
    if (btn) { btn.disabled = false; btn.textContent = "Generate Image"; btn.classList.remove("lora-scanning"); }
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

  const falCloudEngines = ["wan21", "wan21_14b", "runway_gen4"];
  const isFalCloud = falCloudEngines.includes(igActiveVideoEngine);
  const engineLabel = IG_VIDEO_ENGINE_HINTS[igActiveVideoEngine]?.split(" — ")[0] || igActiveVideoEngine;

  const etaMap = { wan21: "~3 min", wan21_14b: "~8 min", wan: "~5 min", runway_gen4: "~2 min" };
  if (statusEl) statusEl.textContent = `Generating via ${engineLabel} — ${etaMap[igActiveVideoEngine] || "a few minutes"}…`;
  if (btn) { btn.disabled = true; btn.textContent = "Generating Video…"; }

  function showVideoResult(outPath) {
    const videoUrl    = outPath.startsWith("http") ? outPath : IG_BASE + outPath;
    const resultBox   = document.getElementById("ig-result");
    const videoResult = document.getElementById("ig-video-result");
    const videoPlayer = document.getElementById("ig-video-player");
    const videoDl     = document.getElementById("ig-video-download");
    if (resultBox)   resultBox.style.display  = "none";
    if (videoResult) videoResult.style.display = "block";
    if (videoPlayer) videoPlayer.src = videoUrl;
    if (videoDl) { videoDl.href = videoUrl; videoDl.download = outPath.split("/").pop() || "levram_video.mp4"; }
    if (statusEl) statusEl.textContent = `Video ready — ${engineLabel}`;
    const vgSection = document.getElementById("ig-video-gallery-section");
    if (vgSection) vgSection.style.display = "block";
    igLoadVideoGallery();
    if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
  }

  try {
    if (isFalCloud) {
      // Async job: submit → poll
      const res  = await levFetch(`${IG_BASE}/video/generate-fal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: igActiveVideoEngine, aspect, duration: 5 }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || "Submit failed");

      levPollJob(data.job_id, IG_BASE, {
        onRunning: (sec) => {
          if (statusEl) statusEl.textContent = `Generating via ${engineLabel} — ${sec}s elapsed…`;
        },
        onComplete: (result) => {
          showVideoResult(result.outputUrl || result.videoUrl);
        },
        onFailed: (err) => {
          if (statusEl) statusEl.textContent = "Failed: " + err;
          if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
        },
      });
      return; // btn re-enabled inside callbacks

    } else {
      const res  = await levFetch(`${IG_BASE}/video/generate-wan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, character, aspect, steps, cfg, seed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || "Video generation failed");
      showVideoResult(data.outputUrl || data.videoUrl);
    }

  } catch (err) {
    console.error("IG VIDEO GENERATE ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "Video generation failed.";
  } finally {
    if (!isFalCloud) {
      if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
    }
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
      <div class="ig-thumb" id="ig-thumb-${img.filename}">
        <img src="${IG_BASE + img.url}" loading="lazy" alt="${img.filename}" onclick="igOpenLightbox('${IG_BASE + img.url}')" style="cursor:pointer;" />
        <div class="ig-thumb-meta">${img.created}</div>
        <button class="ig-thumb-del" onclick="igDeleteImage('${img.filename}')" title="Delete">✕</button>
        <button onclick="igLoadForAnimate('${img.url}')" title="Load for animation"
                style="position:absolute;bottom:20px;left:0;right:0;width:100%;background:rgba(201,168,76,0.85);border:none;color:#000;font-family:Rajdhani,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:3px 0;cursor:pointer;opacity:0;transition:opacity 0.15s;">
          Animate →
        </button>
        <button onclick="igAddToCharRef('${img.url}', this)" title="Add to character as face reference"
                style="position:absolute;bottom:0;left:0;right:0;width:100%;background:rgba(100,180,100,0.85);border:none;color:#000;font-family:Rajdhani,sans-serif;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:3px 0;cursor:pointer;opacity:0;transition:opacity 0.15s;">
          → Char Ref
        </button>
      </div>
    `).join("");
  } catch (err) {
    console.error("IG GALLERY ERROR:", err);
    if (gallery) gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;grid-column:1/-1;">Could not load gallery.</div>`;
  }
}

// ─── Swap Faces on current output ────────────────────────────
async function igSwapFaces() {
  const facePayload1 = igFaceRefs1.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
  const facePayload2 = igFaceRefs2.map(r => ({ base64: r.base64, mediaType: r.mediaType }));

  if (!facePayload1.length && !facePayload2.length) {
    alert("Load face photos into Person 1 (and optionally Person 2) first.");
    return;
  }
  if (!igCurrentImageUrl) {
    alert("No output image to swap faces on. Generate an image first.");
    return;
  }

  const btn      = document.getElementById("ig-swap-btn");
  const statusEl = document.getElementById("ig-status");
  if (btn) { btn.disabled = true; btn.textContent = "Swapping…"; }
  if (statusEl) statusEl.textContent = "Swapping faces onto current output…";

  try {
    const res = await levFetch(`${IG_BASE}/image-gen/face-swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url:        igCurrentImageUrl,
        face_references_1: facePayload1,
        face_references_2: facePayload2,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Face swap failed");

    const imgUrl    = IG_BASE + data.imageUrl;
    const resultImg = document.getElementById("ig-result-img");
    const dlLink    = document.getElementById("ig-download");
    igCurrentImageUrl = data.imageUrl;
    if (resultImg) resultImg.src = imgUrl;
    if (dlLink)    { dlLink.href = imgUrl; dlLink.download = data.imageUrl?.split("/").pop() || "faceswap.png"; }
    if (statusEl)  statusEl.textContent = "Face swap done.";
    await igLoadGallery();
  } catch (err) {
    console.error("SWAP FACES ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "Face swap failed.";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Swap Faces"; }
  }
}

async function igDeleteImage(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  try {
    const res = await levFetch(`${IG_BASE}/image-gen/gallery/${encodeURIComponent(filename)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    const el = document.getElementById(`ig-thumb-${filename}`);
    if (el) el.remove();
  } catch (err) {
    console.error("Delete error:", err);
    alert("Could not delete image.");
  }
}

// ─── Video Gallery ─────────────────────────────────────────
async function igLoadVideoGallery() {
  const gallery = document.getElementById("ig-video-gallery");
  if (!gallery) return;

  try {
    const project = window.LEVRAM_CURRENT_PROJECT || "";
    const qs      = project ? `?project=${encodeURIComponent(project)}` : "";
    const res  = await levFetch(`${IG_BASE}/video/library${qs}`);
    const data = await res.json();
    const vids = data.videos || [];

    if (!vids.length) {
      gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No videos yet.</div>`;
      return;
    }

    gallery.innerHTML = vids.map(v => `
      <div id="ig-vid-${v.name}" style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:8px;position:relative;">
        <button onclick="igDeleteVideo('${v.url}','${v.name}')" title="Delete"
          style="position:absolute;top:4px;right:4px;background:rgba(140,20,20,0.85);border:none;color:#fff;width:20px;height:20px;border-radius:3px;cursor:pointer;font-size:11px;line-height:1;z-index:1;">✕</button>
        <video src="${IG_BASE + v.url}" controls style="width:100%;border-radius:2px;max-height:180px;background:#000;"></video>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:4px;flex-wrap:wrap;">
          <span style="font-size:10px;color:var(--text-dim);letter-spacing:1px;">${v.created} · ${v.size_mb}MB</span>
          <div style="display:flex;gap:4px;">
            <button onclick="igSendToTimeline('${v.url}','${v.name}')"
                    style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#88dd88;background:rgba(0,80,0,0.3);border:1px solid rgba(100,200,100,0.4);padding:3px 8px;border-radius:2px;cursor:pointer;">
              + Timeline
            </button>
            <a href="${IG_BASE + v.url}" download="${v.name}" style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);text-decoration:none;border:1px solid rgba(201,168,76,0.3);padding:3px 8px;border-radius:2px;">DL</a>
          </div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("IG VIDEO GALLERY ERROR:", err);
    if (gallery) gallery.innerHTML = `<div style="color:var(--text-dim);font-size:11px;">Could not load videos.</div>`;
  }
}

window.igDeleteVideo = async function igDeleteVideo(url, name) {
  if (!confirm(`Delete ${name}?`)) return;
  try {
    const res = await levFetch(`${IG_BASE}/video/delete?url=${encodeURIComponent(url)}`, { method: "DELETE" });
    if (!res.ok) throw new Error((await res.json()).detail || "Delete failed");
    document.getElementById(`ig-vid-${name}`)?.remove();
  } catch (err) {
    alert("Could not delete: " + err.message);
  }
};

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

const _FREE_I2V_MODELS = {
  wan21_i2v:     "Wan 2.1",
  wan21_14b_i2v: "Wan 2.1 Best",
  kling_26:      "Kling 2.6 Pro",
};

window.igSendToTimeline = async function igSendToTimeline(videoUrl, name) {
  try {
    const tlRes  = await levFetch(`${IG_BASE}/timeline/load`);
    const tlData = await tlRes.json();
    const shots  = tlData.shots || [];
    shots.push({
      id:               crypto.randomUUID(),
      name:             name || "Video Clip",
      type:             "video",
      videoUrl:         videoUrl,
      renderOutputUrl:  videoUrl,
      renderOutputPath: videoUrl,
      source:           "image_gen",
    });
    const saveRes = await levFetch(`${IG_BASE}/timeline/save-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shots }),
    });
    if (!saveRes.ok) throw new Error("Save failed");
    const statusEl = document.getElementById("ig-status");
    if (statusEl) { statusEl.textContent = `✔ Added to Timeline (${shots.length} clips)`; }
  } catch (err) {
    console.error("SEND TO TIMELINE ERROR:", err);
    alert("Could not add to timeline: " + err.message);
  }
};

window.igLoadForAnimate = function igLoadForAnimate(relUrl) {
  igCurrentImageUrl = relUrl;
  const resultDiv = document.getElementById("ig-result");
  const resultImg = document.getElementById("ig-result-img");
  const i2vPanel  = document.getElementById("ig-i2v-panel");
  const dlLink    = document.getElementById("ig-download");
  const statusEl  = document.getElementById("ig-status");
  if (resultImg) resultImg.src = IG_BASE + relUrl;
  if (resultDiv) resultDiv.style.display = "block";
  if (i2vPanel)  i2vPanel.style.display  = "block";
  if (dlLink)    dlLink.href = IG_BASE + relUrl;
  if (statusEl)  statusEl.textContent = "Image loaded — ready to animate";
  resultDiv?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.igTestAllI2V = async function igTestAllI2V() {
  if (!igCurrentImageUrl) {
    const s = document.getElementById("ig-status");
    if (s) s.textContent = "Load an image first.";
    return;
  }
  const prompt     = document.getElementById("ig-i2v-prompt")?.value   || "";
  const duration   = parseInt(document.getElementById("ig-i2v-duration")?.value || "5");
  const statusEl   = document.getElementById("ig-i2v-status");
  const compareEl  = document.getElementById("ig-i2v-compare");

  if (compareEl) compareEl.style.display = "block";
  if (statusEl)  statusEl.textContent = "Submitting to all free models simultaneously…";

  Object.entries(_FREE_I2V_MODELS).forEach(([key, label]) => {
    const slot = document.getElementById(`ig-i2v-slot-${key}`);
    if (slot) slot.innerHTML = `<div style="color:var(--text-dim);">⏳ ${label}<br>queued…</div>`;
  });

  const results = await Promise.allSettled(
    Object.keys(_FREE_I2V_MODELS).map(async model => {
      const res  = await levFetch(`${IG_BASE}/video/image-to-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: igCurrentImageUrl, prompt, model, duration }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || "submit failed");
      return { model, job_id: data.job_id };
    })
  );

  results.forEach(r => {
    if (r.status === "rejected") return;
    const { model, job_id } = r.value;
    const label = _FREE_I2V_MODELS[model];
    levPollJob(job_id, IG_BASE, {
      onRunning: (sec) => {
        const slot = document.getElementById(`ig-i2v-slot-${model}`);
        if (slot) slot.innerHTML = `<div style="color:var(--text-dim);">⏳ ${label}<br>${sec}s…</div>`;
      },
      onComplete: (res) => {
        const raw = res.outputUrl || res.videoUrl || "";
        const url = raw.startsWith("http") ? raw : IG_BASE + raw;
        const slot = document.getElementById(`ig-i2v-slot-${model}`);
        if (slot) slot.innerHTML = `
          <div style="font-size:10px;color:var(--gold);letter-spacing:1px;margin-bottom:4px;">${label}</div>
          <video src="${url}" controls style="width:100%;border-radius:2px;"></video>
          <a href="${url}" download style="display:block;margin-top:4px;font-size:10px;color:var(--gold);text-align:center;">↓ Download</a>`;
        if (statusEl) statusEl.textContent = `${label} ready`;
      },
      onFailed: (err) => {
        const slot = document.getElementById(`ig-i2v-slot-${model}`);
        if (slot) slot.innerHTML = `<div style="color:#ff6b6b;">${label}: ${err}</div>`;
      },
    });
  });

  if (statusEl) statusEl.textContent = "All 3 jobs running — results appear as they finish";
};

window.igUploadOwnImage = async function igUploadOwnImage() {
  const input    = document.getElementById("ig-upload-input");
  const file     = input?.files?.[0];
  if (!file) return;

  const statusEl = document.getElementById("ig-status");
  if (statusEl) statusEl.textContent = "Uploading…";

  const fd = new FormData();
  fd.append("file", file);

  try {
    const res  = await levFetch(`${IG_BASE}/video/upload-image`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Upload failed");

    igCurrentImageUrl = data.image_url;

    const resultDiv = document.getElementById("ig-result");
    const resultImg = document.getElementById("ig-result-img");
    const i2vPanel  = document.getElementById("ig-i2v-panel");
    const dlLink    = document.getElementById("ig-download");

    if (resultImg) resultImg.src = IG_BASE + data.image_url;
    if (resultDiv) resultDiv.style.display = "block";
    if (i2vPanel)  i2vPanel.style.display  = "block";
    if (dlLink)    { dlLink.href = IG_BASE + data.image_url; dlLink.download = file.name; }
    if (statusEl)  statusEl.textContent = "Image loaded — hit Generate Video to animate";
  } catch (err) {
    if (statusEl) statusEl.textContent = "Upload failed: " + err.message;
    console.error("IG UPLOAD OWN IMAGE ERROR:", err);
  }
  input.value = "";
};

// ── Kling O1 dual-keyframe state ─────────────────────────────
let igEndFrameUrl = null;

window.igHandleI2VModelChange = function igHandleI2VModelChange(model) {
  const endSlot = document.getElementById("ig-i2v-endframe");
  if (endSlot) endSlot.style.display = model === "kling_o1" ? "block" : "none";
};

window.igLoadEndFrame = async function igLoadEndFrame(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res  = await levFetch(`${IG_BASE}/video/upload-image`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Upload failed");
    igEndFrameUrl = data.image_url;
    const img     = document.getElementById("ig-i2v-endframe-img");
    const preview = document.getElementById("ig-i2v-endframe-preview");
    if (img)     { img.src = (igEndFrameUrl.startsWith("http") ? igEndFrameUrl : IG_BASE + igEndFrameUrl); }
    if (preview) preview.style.display = "block";
  } catch (err) {
    alert("End frame upload failed: " + err.message);
  }
  input.value = "";
};

async function igRunI2V() {
  if (!igCurrentImageUrl) return;
  const model    = document.getElementById("ig-i2v-model")?.value    || "wan21_i2v";
  const prompt   = document.getElementById("ig-i2v-prompt")?.value   || "";
  const duration = parseInt(document.getElementById("ig-i2v-duration")?.value || "5");
  const statusEl = document.getElementById("ig-i2v-status");
  const btn      = document.getElementById("ig-i2v-go-btn");

  if (model === "kling_o1" && !igEndFrameUrl) {
    if (statusEl) statusEl.textContent = "Upload an end frame image first for Kling O1.";
    return;
  }

  const modelLabels = {
    wan21_i2v:       "Wan 2.1",
    wan21_14b_i2v:   "Wan 2.1 Best",
    kling_26:        "Kling 2.6 Pro",
    kling_o1:        "Kling O1 Dual-Keyframe",
    runway_turbo:    "Runway Gen-4 Turbo ✦",
    runway_gen4_i2v: "Runway Gen-4.5 ✦",
  };
  const label = modelLabels[model] || model;

  if (statusEl) statusEl.textContent = `Submitting to ${label}…`;
  if (btn) { btn.disabled = true; btn.textContent = "Animating…"; }

  function showI2VResult(outPath) {
    const videoUrl    = outPath.startsWith("http") ? outPath : IG_BASE + outPath;
    const videoResult = document.getElementById("ig-video-result");
    const videoPlayer = document.getElementById("ig-video-player");
    const videoDl     = document.getElementById("ig-video-download");
    const resultBox   = document.getElementById("ig-result");
    const i2vPanel    = document.getElementById("ig-i2v-panel");
    if (i2vPanel)    i2vPanel.style.display   = "none";
    if (resultBox)   resultBox.style.display   = "none";
    if (videoResult) videoResult.style.display = "block";
    if (videoPlayer) videoPlayer.src = videoUrl;
    if (videoDl)     { videoDl.href = videoUrl; videoDl.download = outPath.split("/").pop() || "levram_i2v.mp4"; }
    if (statusEl) statusEl.textContent = `Video ready — ${label}`;
    if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
    const vgSection = document.getElementById("ig-video-gallery-section");
    if (vgSection) vgSection.style.display = "block";
    igLoadVideoGallery();
  }

  try {
    const currentProject = document.getElementById("shot-project")?.value?.trim()
      || window.LEVRAM_CURRENT_PROJECT || "";
    const res  = await levFetch(`${IG_BASE}/video/image-to-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url:     igCurrentImageUrl,
        end_image_url: model === "kling_o1" ? (igEndFrameUrl || "") : "",
        prompt, model, duration,
        project: currentProject,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "I2V submit failed");

    levPollJob(data.job_id, IG_BASE, {
      onRunning: (sec) => { if (statusEl) statusEl.textContent = `Animating via ${label} — ${sec}s elapsed…`; },
      onComplete: (result) => showI2VResult(result.outputUrl || result.videoUrl),
      onFailed:   (err)    => {
        if (statusEl) statusEl.textContent = "Failed: " + err;
        if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
      },
    });

  } catch (err) {
    console.error("IG I2V ERROR:", err);
    if (statusEl) statusEl.textContent = err.message || "I2V failed.";
    if (btn) { btn.disabled = false; btn.textContent = "Generate Video"; }
  }
}

window.igAnimateImage = igAnimateImage;
window.igRunI2V       = igRunI2V;

// ─── Compare All Engines ──────────────────────────────────
const IG_COMPARE_ENGINES = [
  { id: "dalle3",         label: "DALL-E 3" },
  { id: "fal_flux",       label: "FLUX Dev" },
  { id: "fal_flux_schnell", label: "FLUX Schnell" },
  { id: "fal_flux_pro",   label: "FLUX Pro" },
  { id: "fal_flux_pro11", label: "FLUX Pro 1.1" },
];

async function igCompareAll() {
  const prompt       = document.getElementById("ig-prompt")?.value.trim() || "";
  const charSel      = document.getElementById("ig-character");
  const character_id = charSel?.value || "";
  const character    = charSel?.selectedOptions[0]?.dataset.name || "";
  const style        = document.getElementById("ig-style")?.value || "cinematic photorealistic";
  const aspect    = document.getElementById("ig-aspect")?.value || "widescreen";
  const statusEl  = document.getElementById("ig-status");
  const compareBtn = document.getElementById("ig-compare-btn");

  if (!prompt) { if (statusEl) statusEl.textContent = "Enter a prompt first."; return; }

  const refPayload   = igRefImages.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
  const facePayload1 = igFaceRefs1.map(r => ({ base64: r.base64, mediaType: r.mediaType }));
  const facePayload2 = igFaceRefs2.map(r => ({ base64: r.base64, mediaType: r.mediaType }));

  const section = document.getElementById("ig-compare-section");
  const grid    = document.getElementById("ig-compare-grid");
  if (!section || !grid) return;

  // Build placeholder cards
  section.style.display = "block";
  grid.innerHTML = IG_COMPARE_ENGINES.map(e => `
    <div id="ig-cmp-${e.id}" style="background:rgba(0,0,0,0.3);border:1px solid rgba(201,168,76,0.15);border-radius:4px;overflow:hidden;">
      <div style="padding:6px 8px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);border-bottom:1px solid rgba(201,168,76,0.1);">${e.label}</div>
      <div class="ig-cmp-body" style="min-height:140px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:10px;letter-spacing:1px;text-transform:uppercase;">Generating…</div>
    </div>`).join("");

  if (compareBtn) { compareBtn.disabled = true; compareBtn.textContent = "Running…"; }
  if (statusEl)   statusEl.textContent = `Running ${IG_COMPARE_ENGINES.length} engines in parallel…`;

  const run = async (engine) => {
    const body = { prompt, character, style, aspect, engine,
      character_id, character, reference_images: refPayload, face_references_1: facePayload1, face_references_2: facePayload2 };
    try {
      const res  = await levFetch(`${IG_BASE}/image-gen/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || "Failed");
      return { engine, url: IG_BASE + data.imageUrl, ok: true };
    } catch (e) {
      return { engine, error: e.message, ok: false };
    }
  };

  // Fire all in parallel, update cards as each resolves
  const promises = IG_COMPARE_ENGINES.map(e =>
    run(e.id).then(result => {
      const card = document.getElementById(`ig-cmp-${e.id}`);
      if (!card) return result;
      const body = card.querySelector(".ig-cmp-body");
      if (result.ok) {
        body.innerHTML = `
          <div style="position:relative;">
            <img src="${result.url}" style="width:100%;display:block;cursor:zoom-in;" onclick="igOpenLightbox('${result.url}')" />
            <div style="display:flex;gap:4px;padding:6px;">
              <button onclick="igSelectCompareResult('${result.url}')" style="flex:1;background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;padding:4px;border-radius:2px;">✓ Use This</button>
              <a href="${result.url}" download style="background:transparent;border:1px solid rgba(255,255,255,0.1);color:var(--text-dim);font-family:Rajdhani,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;cursor:pointer;padding:4px 8px;border-radius:2px;text-decoration:none;">DL</a>
            </div>
          </div>`;
      } else {
        body.innerHTML = `<div style="padding:10px;font-size:10px;color:#ef5350;text-align:center;">${result.error}</div>`;
      }
      return result;
    })
  );

  await Promise.allSettled(promises);
  if (compareBtn) { compareBtn.disabled = false; compareBtn.textContent = "⚡ Compare All"; }
  if (statusEl)   statusEl.textContent = "Comparison complete.";
  await igLoadGallery();
}

function igSelectCompareResult(url) {
  const resultBox = document.getElementById("ig-result");
  const resultImg = document.getElementById("ig-result-img");
  const dlLink    = document.getElementById("ig-download");
  igCurrentImageUrl = url.replace(IG_BASE, "");
  if (resultBox) resultBox.style.display = "block";
  if (resultImg) resultImg.src = url;
  if (dlLink)    { dlLink.href = url; dlLink.download = url.split("/").pop(); }
}

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
  document.getElementById("ig-character")?.addEventListener("change", function() {
    igRenderCharacterImages(this.value);
    igAutoFillCharPrompt(this.value);
  });

  // Clear the auto-fill flag when user manually edits the prompt
  document.getElementById("ig-prompt")?.addEventListener("input", function() {
    this.dataset.autofilled = "";
  });
});

"use strict";

const BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

let _llLocations = [];
let _llEditingId = null;

function _llStatus(msg, color = "#aaa") {
  const el = document.getElementById("location-lab-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = color;
  el.style.display = msg ? "block" : "none";
}

function _llGetField(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function _llSetField(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || "";
}

// ── Load list ────────────────────────────────────────────────
async function loadLocations() {
  try {
    const res  = await levFetch(`${BASE}/locations`);
    const data = await res.json();
    _llLocations = data.locations || [];
    _renderList();
    const countEl = document.getElementById("ll-count");
    if (countEl) countEl.textContent = `${_llLocations.length} location${_llLocations.length !== 1 ? "s" : ""}`;
  } catch (e) {
    _llStatus("Failed to load locations: " + e.message, "#f55");
  }
}

function _renderList() {
  const el = document.getElementById("ll-list");
  if (!el) return;
  if (!_llLocations.length) {
    el.innerHTML = `<p style="color:#444;font-size:11px;letter-spacing:2px;text-transform:uppercase;">No locations yet.</p>`;
    return;
  }
  el.innerHTML = _llLocations.map(loc => `
    <div class="cl-char-card ${loc.id === _llEditingId ? "active" : ""}" onclick="editLocation('${loc.id}')"
      style="cursor:pointer;padding:10px 12px;border:1px solid ${loc.id === _llEditingId ? "#c9a84c" : "#222"};border-radius:4px;background:${loc.id === _llEditingId ? "rgba(201,168,76,0.08)" : "#111"};">
      <div style="font-size:14px;font-weight:700;color:#fff;letter-spacing:.04em;">${loc.name}</div>
      <div style="font-size:11px;color:#666;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${loc.time_of_day || ""}${loc.time_of_day && loc.weather ? " · " : ""}${loc.weather || ""}${(loc.time_of_day || loc.weather) && loc.description ? " · " : ""}${(loc.description || "").slice(0, 60)}</div>
    </div>
  `).join("");
}

// ── New / Edit ───────────────────────────────────────────────
window.newLocation = function() {
  _llEditingId = null;
  _llClearForm();
  document.getElementById("ll-edit-badge").style.display = "none";
  document.getElementById("ll-delete-btn").style.display = "none";
  document.getElementById("ll-ref-gallery").innerHTML = "";
  document.getElementById("ll-preview-wrap").style.display = "none";
  _renderList();
};

window.editLocation = function(id) {
  const loc = _llLocations.find(l => l.id === id);
  if (!loc) return;
  _llEditingId = id;
  _llSetField("loc-name",         loc.name);
  _llSetField("loc-description",  loc.description);
  _llSetField("loc-lighting",     loc.lighting);
  _llSetField("loc-atmosphere",   loc.atmosphere);
  _llSetField("loc-color-palette",loc.color_palette);
  _llSetField("loc-time-of-day",  loc.time_of_day);
  _llSetField("loc-weather",      loc.weather);
  _llSetField("loc-camera-notes", loc.camera_notes);
  document.getElementById("ll-edit-badge").style.display = "inline";
  document.getElementById("ll-delete-btn").style.display = "inline-block";
  _renderRefGallery(loc);
  _renderList();
};

function _llClearForm() {
  ["loc-name","loc-description","loc-lighting","loc-atmosphere",
   "loc-color-palette","loc-camera-notes"].forEach(id => _llSetField(id, ""));
  _llSetField("loc-time-of-day", "");
  _llSetField("loc-weather", "");
}

// ── Save ────────────────────────────────────────────────────
window.saveLocation = async function() {
  const name = _llGetField("loc-name");
  if (!name) { _llStatus("Name is required.", "#f55"); return; }

  const payload = {
    name,
    description:   _llGetField("loc-description"),
    lighting:      _llGetField("loc-lighting"),
    atmosphere:    _llGetField("loc-atmosphere"),
    color_palette: _llGetField("loc-color-palette"),
    time_of_day:   _llGetField("loc-time-of-day"),
    weather:       _llGetField("loc-weather"),
    camera_notes:  _llGetField("loc-camera-notes"),
  };

  try {
    let res, data;
    if (_llEditingId) {
      res  = await levFetch(`${BASE}/locations/${_llEditingId}`, {
        method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload),
      });
      data = await res.json();
      if (!data.success) throw new Error(data.error || "Update failed");
      _llStatus("Location updated.", "#4caf50");
    } else {
      res  = await levFetch(`${BASE}/locations`, {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload),
      });
      data = await res.json();
      if (!data.success) throw new Error(data.error || "Create failed");
      _llEditingId = data.location.id;
      document.getElementById("ll-edit-badge").style.display = "inline";
      document.getElementById("ll-delete-btn").style.display = "inline-block";
      _llStatus("Location saved.", "#4caf50");
    }
    await loadLocations();
  } catch (e) {
    _llStatus("Error: " + e.message, "#f55");
  }
};

// ── Delete ──────────────────────────────────────────────────
window.deleteLocation = async function() {
  if (!_llEditingId) return;
  const loc = _llLocations.find(l => l.id === _llEditingId);
  if (!confirm(`Delete "${loc?.name}"?`)) return;
  try {
    await levFetch(`${BASE}/locations/${_llEditingId}`, { method: "DELETE" });
    _llEditingId = null;
    _llClearForm();
    document.getElementById("ll-edit-badge").style.display = "none";
    document.getElementById("ll-delete-btn").style.display = "none";
    document.getElementById("ll-ref-gallery").innerHTML = "";
    document.getElementById("ll-preview-wrap").style.display = "none";
    _llStatus("Deleted.", "#888");
    await loadLocations();
  } catch (e) {
    _llStatus("Delete failed: " + e.message, "#f55");
  }
};

// ── Reference images ────────────────────────────────────────
function llHandleDrop(e) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files?.length) llUploadRefs(files);
}

window.llUploadRefs = async function(files) {
  if (!_llEditingId) {
    _llStatus("Save the location first before uploading references.", "#f55");
    return;
  }
  for (const file of Array.from(files)) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      _llStatus(`Uploading ${file.name}…`, "#aaa");
      const res  = await levFetch(`${BASE}/locations/${_llEditingId}/upload-reference`, { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Upload failed");
      _llStatus(`Uploaded ${file.name}`, "#4caf50");
    } catch (e) {
      _llStatus(`Upload failed: ${e.message}`, "#f55");
    }
  }
  await loadLocations();
  const loc = _llLocations.find(l => l.id === _llEditingId);
  if (loc) _renderRefGallery(loc);
};

function _renderRefGallery(loc) {
  const el = document.getElementById("ll-ref-gallery");
  if (!el) return;
  const refs = loc.reference_images || [];
  if (!refs.length) { el.innerHTML = ""; return; }
  el.innerHTML = refs.map(p => {
    const fname = p.split("/").pop();
    return `<div style="position:relative;">
      <img src="${BASE}/output/renders/location_refs/${fname}" style="width:100px;height:70px;object-fit:cover;border-radius:4px;border:1px solid #2a2a2a;" />
    </div>`;
  }).join("");
}

// ── Generate Preview ─────────────────────────────────────────
window.generateLocationPreview = async function() {
  const name        = _llGetField("loc-name");
  const description = _llGetField("loc-description");
  const lighting    = _llGetField("loc-lighting");
  const atmosphere  = _llGetField("loc-atmosphere");
  const palette     = _llGetField("loc-color-palette");
  const timeOfDay   = _llGetField("loc-time-of-day");
  const weather     = _llGetField("loc-weather");

  const parts = [
    name && `${name}:`,
    description,
    lighting,
    atmosphere,
    palette,
    timeOfDay,
    weather,
    "cinematic establishing shot, wide angle, no people, environment only, ultra-detailed",
  ].filter(Boolean);

  const prompt = parts.join(", ");

  const wrapEl  = document.getElementById("ll-preview-wrap");
  const imgEl   = document.getElementById("ll-preview-img");
  const statEl  = document.getElementById("ll-preview-status");

  wrapEl.style.display = "block";
  imgEl.style.display  = "none";
  if (statEl) statEl.textContent = "Generating environment preview… (~20s)";

  try {
    const res  = await levFetch(`${BASE}/image-gen/generate`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ prompt, engine: "ws_flux", aspect: "16:9", style: "", studio: "levram" }),
    });
    const data = await res.json();
    const url  = data.outputUrl || data.imageUrl || data.url || data.output_url || "";
    if (!url) throw new Error("No image URL in response");
    imgEl.src           = BASE + url;
    imgEl.style.display = "block";
    if (statEl) statEl.textContent = "Preview generated — ws_flux ~$0.012";
  } catch (e) {
    if (statEl) statEl.textContent = "Preview failed: " + e.message;
  }
};

// ── Init ─────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", loadLocations);

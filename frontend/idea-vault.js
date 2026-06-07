// ─── Idea Vault ───────────────────────────────────────────
const IV_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

async function ivLoadIdeas() {
  const list = document.getElementById("iv-list");
  if (!list) return;

  try {
    const res = await levFetch(`${IV_BASE}/ideas`);
    const data = await res.json();
    const ideas = data.ideas || [];

    if (!ideas.length) {
      list.innerHTML = `<p style="color:var(--text-dim);font-size:11px;letter-spacing:2px;text-transform:uppercase;">No ideas saved yet.</p>`;
      return;
    }

    list.innerHTML = ideas.map(idea => `
      <div class="iv-card">
        <div class="iv-card-top">
          <span class="iv-card-title">${idea.title || "Untitled"}</span>
          <span class="iv-card-date">${idea.createdAt || ""}</span>
          <button class="tl-del-btn" title="Delete idea" onclick="ivDeleteIdea('${idea.id}')">✕</button>
        </div>
        ${idea.tags?.length ? `<div class="iv-tags">${idea.tags.map(t => `<span class="iv-tag">${t}</span>`).join("")}</div>` : ""}
        <div class="iv-card-body">${idea.rawIdea || ""}</div>
      </div>
    `).join("");
  } catch (err) {
    console.error("IV LOAD ERROR:", err);
    const list = document.getElementById("iv-list");
    if (list) list.innerHTML = `<p style="color:var(--imperial-red);font-size:11px;">Could not load ideas.</p>`;
  }
}

async function ivSaveIdea() {
  const title = document.getElementById("iv-title")?.value.trim() || "";
  const text  = document.getElementById("iv-text")?.value.trim()  || "";
  const tags  = document.getElementById("iv-tags")?.value.trim()  || "";

  const ivStatus = document.getElementById("iv-status");

  if (!title) {
    if (ivStatus) ivStatus.textContent = "Add a title first.";
    return;
  }
  if (!text) {
    if (ivStatus) ivStatus.textContent = "Write the idea before saving.";
    return;
  }

  const payload = {
    title,
    rawIdea: text,
    source: "web",
    tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : []
  };

  try {
    const res = await levFetch(`${IV_BASE}/ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || "Save failed");

    // Clear form
    document.getElementById("iv-title").value = "";
    document.getElementById("iv-text").value = "";
    document.getElementById("iv-tags").value = "";
    if (ivStatus) ivStatus.textContent = `Saved: "${title}"`;

    await ivLoadIdeas();
  } catch (err) {
    console.error("IV SAVE ERROR:", err);
    if (ivStatus) ivStatus.textContent = err.message || "Failed to save.";
  }
}

async function ivDeleteIdea(id) {
  try {
    const res = await levFetch(`${IV_BASE}/ideas/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error("Delete failed");
    await ivLoadIdeas();
  } catch (err) {
    console.error("IV DELETE ERROR:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("iv-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", ivSaveIdea);
  ivLoadIdeas();
});

window.ivDeleteIdea = ivDeleteIdea;

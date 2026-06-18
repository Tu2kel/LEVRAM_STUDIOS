const ORCH_BASE = window.LEVRAM_CONFIG?.api || "http://127.0.0.1:8000";

// Populate character dropdown on load
async function orchLoadCharacters() {
  const sel = document.getElementById("orch-character");
  if (!sel) return;
  try {
    const res  = await levFetch(`${ORCH_BASE}/characters`);
    const data = await res.json();
    (data.characters || []).forEach(c => {
      const opt = document.createElement("option");
      opt.value        = c.id;
      opt.textContent  = c.name;
      opt.dataset.name = c.name;
      sel.appendChild(opt);
    });
    // Restore last-used character
    const saved = window.LEVRAM_CHAR?.getId?.() || localStorage.getItem("levram_active_char_id") || "";
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
  } catch (_) {}
}

document.addEventListener("DOMContentLoaded", orchLoadCharacters);

let _orchPollInterval = null;

window.orchRun = async function orchRun() {
  const concept   = document.getElementById("orch-concept")?.value.trim();
  const charSel   = document.getElementById("orch-character");
  const charId    = charSel?.value || "";
  const charName  = charSel?.selectedOptions?.[0]?.dataset?.name || "";
  const numShots  = parseInt(document.getElementById("orch-shots")?.value  || "3");
  const duration  = parseInt(document.getElementById("orch-duration")?.value || "5");
  const model     = document.getElementById("orch-model")?.value || "ws_wan22";
  const tts       = document.getElementById("orch-tts")?.checked || false;

  if (!concept) {
    alert("Enter a scene concept first.");
    return;
  }

  const btn        = document.getElementById("orch-run-btn");
  const wrapEl     = document.getElementById("orch-progress-wrap");
  const stepEl     = document.getElementById("orch-step");
  const barEl      = document.getElementById("orch-bar");
  const resultEl   = document.getElementById("orch-result");

  if (btn)    { btn.disabled = true; btn.textContent = "Running…"; btn.classList.add("lora-scanning"); }
  if (wrapEl) wrapEl.style.display = "block";
  if (resultEl) resultEl.textContent = "";
  if (barEl)  barEl.style.width = "5%";
  if (stepEl) stepEl.textContent = "Submitting…";

  try {
    const res  = await levFetch(`${ORCH_BASE}/orchestrate/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concept, character_id: charId, character_name: charName,
                             num_shots: numShots, duration, model, include_tts: tts }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to start");

    _orchPoll(data.job_id, numShots, btn, stepEl, barEl, resultEl);
  if (window.BC) BC.watchJob(data.job_id, "Auto-Create Scene");

  } catch (err) {
    if (btn)  { btn.disabled = false; btn.textContent = "⚡ Auto-Create Scene"; }
    if (stepEl) stepEl.textContent = "Error: " + err.message;
  }
};

function _orchPoll(jobId, totalShots, btn, stepEl, barEl, resultEl) {
  if (_orchPollInterval) clearInterval(_orchPollInterval);

  _orchPollInterval = setInterval(async () => {
    try {
      const res  = await levFetch(`${ORCH_BASE}/orchestrate/status/${jobId}`);
      const data = await res.json();

      if (stepEl) stepEl.textContent = data.step || data.status || "…";

      const pct = data.total > 0 ? Math.round((data.progress / data.total) * 90) + 5 : 10;
      if (barEl) barEl.style.width = `${pct}%`;

      if (data.status === "complete") {
        clearInterval(_orchPollInterval);
        if (barEl)    barEl.style.width = "100%";
        if (resultEl) resultEl.textContent = `✔ ${data.shots?.length || totalShots} clips added to Timeline`;
        if (btn)      { btn.disabled = false; btn.textContent = "⚡ Auto-Create Scene"; btn.classList.remove("lora-scanning"); }
        if (typeof igLoadVideoGallery === "function") igLoadVideoGallery();
      } else if (data.status === "failed") {
        clearInterval(_orchPollInterval);
        if (barEl)    barEl.style.background = "#ff4444";
        if (resultEl) resultEl.style.color = "#ff6b6b";
        if (resultEl) resultEl.textContent = "Failed: " + (data.error || "unknown error");
        if (btn)      { btn.disabled = false; btn.textContent = "⚡ Auto-Create Scene"; btn.classList.remove("lora-scanning"); }
      }
    } catch (e) {
      if (window.BC) BC.log("Orchestrate poll error: " + e.message, "error");
    }
  }, 15000);
}

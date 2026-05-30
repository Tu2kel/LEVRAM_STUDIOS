const BATTERY_STAGES = [
  { key: "idea", label: "IDEA" },
  { key: "script", label: "SCRIPT" },
  { key: "voice", label: "VOICE" },
  { key: "shot", label: "SHOT" },
  { key: "render", label: "RENDER" },
  { key: "export", label: "EXPORT" },
];

function getSceneBatteryStatus(scene = {}) {
  return {
    idea: Boolean(scene.id || scene.project || scene.shotDesc || scene.shotPrompt),
    script: Boolean(scene.dialogue && scene.dialogue.trim()),
    voice: Boolean(scene.rawUrl || scene.fxUrl),
    shot: Boolean(scene.shotPrompt && scene.shotPrompt.trim()),
    render: Boolean(scene.renderStatus === "complete"),
    export: Boolean(scene.exportUrl || scene.exportedAt),
  };
}

function renderProjectBattery(scene = null) {
  const host = document.getElementById("project-battery-host");
  if (!host) return;

  const activeScene = scene || window.activeScene || null;
  const status = getSceneBatteryStatus(activeScene || {});
  const completeCount = Object.values(status).filter(Boolean).length;

  const title = activeScene
    ? `${activeScene.shot_number || activeScene.id || "Selected Scene"}`
    : "No Scene Selected";

  host.innerHTML = `
    <section class="project-battery">
      <div class="battery-head">
        <div>
          <div class="battery-label">Project Battery</div>
          <div class="battery-title">${title}</div>
        </div>
        <div class="battery-count">${completeCount} / ${BATTERY_STAGES.length} COMPLETE</div>
      </div>

      <div class="battery-chain">
        ${BATTERY_STAGES.map((stage, index) => {
          const done = status[stage.key];
          const current = !done && Object.values(status).slice(0, index).every(Boolean);

          return `
            <div class="battery-chevron ${done ? "done" : ""} ${current ? "current" : ""}">
              <span>${stage.label}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function setActiveSceneForBattery(scene) {
  window.activeScene = scene;
  renderProjectBattery(scene);
}

document.addEventListener("DOMContentLoaded", () => {
  renderProjectBattery(null);
});

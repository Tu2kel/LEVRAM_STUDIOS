const BATTERY_STAGES = [
  {
    key: "idea",
    label: "Idea",
    num: "01",
    sub: "Develop your concept in Idea Vault.",
    icon: "idea",
  },
  {
    key: "script",
    label: "Script",
    num: "02",
    sub: "Build the story, scenes, and dialogue.",
    icon: "script",
  },
  {
    key: "voice",
    label: "Voice",
    num: "03",
    sub: "Generate and process character voices.",
    icon: "voice",
  },
  {
    key: "shot",
    label: "Shot",
    num: "04",
    sub: "Build character faces and shots in Image Gen.",
    icon: "shot",
  },
  {
    key: "render",
    label: "Render",
    num: "05",
    sub: "Animate scenes and assemble clips.",
    icon: "render",
  },
  {
    key: "export",
    label: "Export",
    num: "06",
    sub: "Publish and distribute the final cut.",
    icon: "export",
  },
];

// Where each stage navigates when clicked
const STAGE_NAV = {
  idea:   () => window.switchTab?.("idea-vault"),
  script: () => window.open("story-engine.html", "_blank"),
  voice:  () => window.open("voice-clone.html", "_blank"),
  shot:   () => window.switchTab?.("image-gen"),
  render: () => window.open("render-queue.html", "_blank"),
  export: () => window.open("export.html", "_blank"),
};

const BATTERY_ICONS = {
  idea: `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12.9V17H8v-2.1A7 7 0 0 1 12 2z"/></svg>`,
  script: `<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="17" x2="12" y2="17"/><path d="M16 14l2 2-2 2"/></svg>`,
  voice: `<svg viewBox="0 0 24 24"><path d="M2 12h2M4 8h2M4 16h2M8 6h1M8 18h1"/><path d="M12 4v16M16 7v10M20 9v6"/></svg>`,
  shot: `<svg viewBox="0 0 24 24"><rect x="2" y="6" width="15" height="12" rx="2"/><path d="M17 10l5-3v10l-5-3"/><line x1="6" y1="6" x2="6" y2="2"/><line x1="10" y1="6" x2="10" y2="2"/></svg>`,
  render: `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 21h8M12 18v3M9 10l2 2 4-4"/></svg>`,
  export: `<svg viewBox="0 0 24 24"><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>`,
};

function getSceneBatteryStatus(scene) {
  if (!scene)
    return { idea: false, script: false, voice: false, shot: false, render: false, export: false };
  return {
    idea:   Boolean(scene.id || scene.project || scene.shotDesc || scene.shotPrompt),
    script: Boolean(scene.dialogue && scene.dialogue.trim()),
    voice:  Boolean(scene.rawUrl || scene.fxUrl),
    shot:   Boolean(scene.shotPrompt && scene.shotPrompt.trim()),
    render: Boolean(scene.renderStatus === "complete"),
    export: Boolean(scene.exportUrl || scene.exportedAt),
  };
}

function getProjectBatteryStatus(projectName, scenes, queue) {
  const name = (projectName || "").toLowerCase().trim();
  const ps = (scenes || []).filter(s =>
    (s.project || s.title || "").toLowerCase().trim() === name
  );
  const pq = (queue || []).filter(q =>
    (q.project || "").toLowerCase().trim() === name
  );
  if (!ps.length && !pq.length) return getSceneBatteryStatus(null);
  return {
    idea:   true,
    script: ps.some(s => s.dialogue && s.dialogue.trim()),
    voice:  ps.some(s => s.rawUrl || s.fxUrl || s.voicePath),
    shot:   ps.some(s => s.shotPrompt && s.shotPrompt.trim()),
    render: pq.some(q => q.status === "complete") || ps.some(s => s.renderStatus === "complete"),
    export: ps.some(s => s.exportUrl || s.exportedAt),
  };
}

function renderProjectBattery(scene) {
  const host = document.getElementById("project-battery-host");
  if (!host) return;

  // Determine project name from: shot-project input → scene → fallback
  const projectName = (
    document.getElementById("shot-project")?.value?.trim() ||
    scene?.project || scene?.title || null
  );

  // Use project-level status when we have enough data, else scene-level
  let status;
  if (projectName && (window.shots?.length || window.renderQueue?.length)) {
    status = getProjectBatteryStatus(projectName, window.shots, window.renderQueue);
  } else {
    status = getSceneBatteryStatus(scene);
  }

  const doneCount = Object.values(status).filter(Boolean).length;
  const total = BATTERY_STAGES.length;
  const pct = Math.round((doneCount / total) * 100);
  const C = 2 * Math.PI * 26;

  const sceneName = projectName || "No Project Selected";

  // Current and next stage
  const curIdx = BATTERY_STAGES.findIndex((s) => !status[s.key]);
  const cur = curIdx >= 0 ? BATTERY_STAGES[curIdx] : BATTERY_STAGES[total - 1];
  const nxt =
    curIdx >= 0 && curIdx < total - 1 ? BATTERY_STAGES[curIdx + 1] : null;
  const offset = C - (pct / 100) * C;

  const chevrons = BATTERY_STAGES.map((s, i) => {
    const done = status[s.key];
    const active =
      !done && (i === 0 || Object.values(status).slice(0, i).every(Boolean));
    const isExport = s.key === "export";
    const cls = done
      ? "done"
      : active
        ? isExport
          ? "export-active"
          : "active"
        : isExport
          ? "export-active"
          : "";
    return `<div class="pb-stage ${cls}" data-stage="${s.key}" title="${s.label}: ${s.sub}">
      <div class="pb-stage-icon">${BATTERY_ICONS[s.icon]}</div>
      <div class="pb-stage-name">${s.label}</div>
      <div class="pb-stage-num">${s.num}</div>
    </div>`;
  }).join("");

  const nextBlock = nxt
    ? `
    <div class="pb-arrows"><span></span><span></span><span></span></div>
    <div class="pb-s-item">
      <div class="pb-s-icon g">${BATTERY_ICONS.bolt}</div>
      <div>
        <div class="pb-s-label g">Next Up</div>
        <div class="pb-s-title">${nxt.label}</div>
        <div class="pb-s-sub">${nxt.sub}</div>
      </div>
      <button class="pb-go-btn" data-go="${nxt.key}">→ Go</button>
    </div>`
    : "";

  host.innerHTML = `
    <div class="pb-shell">
      <div class="pb-top">
        <div>
          <div class="pb-eyebrow">♛ Current Project:</div>
          <div class="pb-scene-name">${sceneName}</div>
        </div>
        <div class="pb-prog-block">
          <div class="pb-prog-label">Progress</div>
          <div class="pb-ring-wrap">
            <svg viewBox="0 0 60 60">
              <circle class="pb-ring-bg"   cx="30" cy="30" r="26"/>
              <circle class="pb-ring-fill" cx="30" cy="30" r="26"
                style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${C.toFixed(1)}"
                data-offset="${offset.toFixed(1)}"/>
            </svg>
            <div class="pb-ring-pct" id="pb-rpct">0%</div>
          </div>
          <div class="pb-fraction">${doneCount} / ${total} <small>Complete</small></div>
        </div>
      </div>

      <div class="pb-stages">${chevrons}</div>

      <div class="pb-status">
        <div class="pb-s-item">
          <div class="pb-s-icon">${BATTERY_ICONS.star}</div>
          <div>
            <div class="pb-s-label">Current Stage</div>
            <div class="pb-s-title">${cur.label} Development</div>
            <div class="pb-s-sub">${cur.sub}</div>
          </div>
        </div>
        ${nextBlock}
      </div>

      <div class="pb-bar-wrap">
        <div class="pb-bar-fill" id="pb-bfill" style="width:0%"></div>
        <div class="pb-bar-dot"  id="pb-bdot"  style="left:0%"></div>
        <div class="pb-bar-dot end"></div>
      </div>
      <div class="pb-tagline">Stay locked in. Execute the vision.</div>
    </div>
  `;

  // Wire chevron click navigation
  host.querySelectorAll(".pb-stage[data-stage]").forEach(el => {
    el.addEventListener("click", () => {
      const nav = STAGE_NAV[el.dataset.stage];
      if (nav) nav();
    });
  });
  const goBtn = host.querySelector(".pb-go-btn[data-go]");
  if (goBtn) {
    goBtn.addEventListener("click", () => {
      const nav = STAGE_NAV[goBtn.dataset.go];
      if (nav) nav();
    });
  }

  // Animate
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const rf = host.querySelector(".pb-ring-fill");
      if (rf) rf.style.strokeDashoffset = rf.dataset.offset;

      const rp = document.getElementById("pb-rpct");
      if (rp) {
        let v = 0;
        const go = () => {
          v += Math.ceil((pct - v) / 7) || 1;
          rp.textContent = v + "%";
          if (v < pct) requestAnimationFrame(go);
          else rp.textContent = pct + "%";
        };
        setTimeout(go, 150);
      }

      const bf = document.getElementById("pb-bfill");
      const bd = document.getElementById("pb-bdot");
      if (bf) bf.style.width = pct + "%";
      if (bd) bd.style.left = pct + "%";
    }),
  );
}

function setActiveSceneForBattery(scene) {
  window.activeScene = scene;
  renderProjectBattery(scene);
}

// Call this after shots or queue load to refresh project-level status
window.refreshBattery = function() {
  renderProjectBattery(window.activeScene || null);
};

document.addEventListener("DOMContentLoaded", () => {
  renderProjectBattery(null);
});

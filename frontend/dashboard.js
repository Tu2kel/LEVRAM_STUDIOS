// ─── Dashboard ─────────────────────────────────────────────────
(function () {
  const API = window.API_BASE || "";
  let _pollTimer = null;
  let _refreshTimer = null;

  // ── Entry point called when tab is shown ─────────────────────
  window.dbLoad = function () {
    clearTimeout(_refreshTimer);
    _startClock();
    _fetchAll();
    // Only reschedule while dashboard panel is visible — stops polling when user switches tabs
    const panel = document.getElementById("tab-dashboard");
    if (!panel || panel.style.display !== "none") {
      _refreshTimer = setTimeout(dbLoad, 30_000);
    }
  };

  let _clockInterval = null;
  function _startClock() {
    if (_clockInterval) return; // already running
    const clockEl = document.getElementById("db-clock");
    const dateEl  = document.getElementById("db-date");
    function _tick() {
      const now = new Date();
      if (clockEl) clockEl.textContent = now.toLocaleTimeString("en-US", { hour12: false });
      if (dateEl)  dateEl.textContent  = now.toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric", year:"numeric" }).toUpperCase();
    }
    _tick();
    _clockInterval = setInterval(_tick, 1000);
  }

  // ── Parallel fetch everything ─────────────────────────────────
  async function _fetchAll() {
    const el = id => document.getElementById(id);
    const lf = typeof levFetch === "function" ? levFetch : fetch;

    const [ideas, charCount, shots, vids, jobs] = await Promise.allSettled([
      lf(`${API}/ideas`).then(r => r.json()),
      lf(`${API}/characters/count`).then(r => r.json()),
      lf(`${API}/timeline/load`).then(r => r.json()),
      lf(`${API}/video/library`).then(r => r.json()),
      lf(`${API}/orchestrate/jobs`).then(r => r.json()),
    ]);

    const ideaList  = ideas.value?.ideas  || [];
    const charList  = { length: charCount.value?.count ?? 0 };
    const shotList  = shots.value?.shots  || [];
    const vidList   = vids.value?.videos  || [];
    const jobList   = jobs.value?.jobs    || [];

    _renderActiveJob(jobList);
    _renderStats(ideaList, charList, shotList, vidList);
    _renderLastLeft(ideaList, shotList);
    _renderRecentClips(vidList);
    _renderProjects(ideaList, vidList);
  }

  // ── Active pipeline job (only shown if something is running) ─
  function _renderActiveJob(jobs) {
    const banner = document.getElementById("db-active-job");
    if (!banner) return;

    const active = jobs.filter(j =>
      j.status !== "complete" && j.status !== "failed" && j.status !== "cancelled"
    );

    if (!active.length) {
      banner.style.display = "none";
      clearTimeout(_pollTimer);
      return;
    }

    banner.style.display = "flex";
    const j = active[0];
    const prog = j.total ? Math.round((j.progress / j.total) * 100) : 0;
    const step = j.step || j.status || "Working…";
    const elapsed = j.started_at
      ? _elapsedLabel(j.started_at)
      : "";

    banner.innerHTML = `
      <div class="db-job-left">
        <span class="db-job-pulse"></span>
        <span class="db-job-title">Pipeline Running</span>
        <span class="db-job-step">${_esc(step)}</span>
      </div>
      <div class="db-job-right">
        <div class="db-job-bar-wrap">
          <div class="db-job-bar-fill" style="width:${prog}%"></div>
        </div>
        <span class="db-job-pct">${j.total ? `${j.progress}/${j.total} shots` : prog + "%"}</span>
        ${elapsed ? `<span class="db-job-time">${elapsed}</span>` : ""}
      </div>
    `;

    // Keep polling while something is active
    clearTimeout(_pollTimer);
    _pollTimer = setTimeout(async () => {
      const lf = typeof levFetch === "function" ? levFetch : fetch;
      const r = await lf(`${API}/orchestrate/jobs`).then(x => x.json()).catch(() => ({ jobs: [] }));
      _renderActiveJob(r.jobs || []);
    }, 5000);
  }

  // ── Stats bar ─────────────────────────────────────────────────
  function _renderStats(ideas, chars, shots, vids) {
    _countUp("db-stat-ideas", ideas.length);
    _countUp("db-stat-chars", chars.length);
    _countUp("db-stat-shots", shots.length);
    _countUp("db-stat-films", vids.length);

    const totalMin = Math.round((shots.length * 5) / 60 * 10) / 10;
    const runtimeEl = document.getElementById("db-stat-runtime");
    if (runtimeEl) runtimeEl.textContent = totalMin > 0 ? totalMin + "m" : "0m";
  }

  function _countUp(id, target) {
    const el = document.getElementById(id);
    if (!el || target === 0) { if (el) el.textContent = target; return; }
    let cur = 0;
    const step = Math.ceil(target / 20);
    const timer = setInterval(() => {
      cur = Math.min(cur + step, target);
      el.textContent = cur;
      if (cur >= target) clearInterval(timer);
    }, 30);
  }

  // ── "Where I left off" card ───────────────────────────────────
  function _renderLastLeft(ideas, shots) {
    const wrap = document.getElementById("db-left-off");
    if (!wrap) return;

    // Most recently updated in-progress idea
    const wip = ideas
      .filter(i => i.status !== "done" && i.status !== "cancelled")
      .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""))[0];

    if (!wip) {
      wrap.innerHTML = `<p class="db-empty">No active ideas — create one in the Idea Vault.</p>`;
      return;
    }

    const sceneCnt = wip.story?.scenes?.length || 0;
    const estMin   = wip.story?.est_minutes || wip.target_minutes || "?";
    const badge    = _statusBadge(wip.status);

    wrap.innerHTML = `
      <div class="db-wip-card">
        <div class="db-wip-top">
          <span class="db-wip-title">${_esc(wip.title)}</span>
          ${badge}
        </div>
        <p class="db-wip-logline">${_esc(wip.story?.logline || wip.rawIdea?.slice(0, 120) || "")}</p>
        <div class="db-wip-meta">
          ${sceneCnt ? `<span>${sceneCnt} scenes</span>` : ""}
          ${estMin ? `<span>~${estMin} min</span>` : ""}
          ${wip.genre ? `<span>${_esc(wip.genre)}</span>` : ""}
        </div>
        <div class="db-wip-actions">
          <button class="db-btn-red" onclick="dbGoToIdea('${wip.id}')"><span>CONTINUE →</span></button>
          ${shots.length ? `<span class="db-wip-shots">${shots.length} shots in timeline</span>` : ""}
        </div>
      </div>
    `;
  }

  // ── Recent clips grid ─────────────────────────────────────────
  function _renderRecentClips(vids) {
    const grid = document.getElementById("db-clips-grid");
    if (!grid) return;

    const recent = vids.slice(0, 8);
    if (!recent.length) {
      grid.innerHTML = `<p class="db-empty">No clips yet — generate images or animate shots.</p>`;
      return;
    }

    grid.innerHTML = recent.map(v => {
      const name  = v.name || "";
      const label = name.replace(/\.[^.]+$/, "").replace(/_/g, " ").slice(0, 24);
      const proj  = v.project ? `<span class="db-clip-proj">${_esc(v.project)}</span>` : "";
      const date  = v.created ? `<span class="db-clip-date">${v.created.slice(0, 10)}</span>` : "";
      return `
        <div class="db-clip-card" onclick="dbOpenClip('${_esc(v.url)}')">
          <div class="db-clip-thumb">
            <video src="${_esc(v.url)}" muted preload="none"
              onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0">
            </video>
          </div>
          <div class="db-clip-meta">
            ${proj}
            <span class="db-clip-name">${_esc(label)}</span>
            ${date}
          </div>
        </div>`;
    }).join("");
  }

  // ── Project cards ─────────────────────────────────────────────
  function _renderProjects(ideas, vids) {
    const grid = document.getElementById("db-projects-grid");
    if (!grid) return;

    // Group videos by project
    const projMap = {};
    vids.forEach(v => {
      const p = v.project || "Untagged";
      if (!projMap[p]) projMap[p] = { clips: [], lastDate: "" };
      projMap[p].clips.push(v);
      if ((v.created || "") > projMap[p].lastDate) projMap[p].lastDate = v.created || "";
    });

    // Merge in ideas that have no matching project entry yet
    ideas.forEach(i => {
      const p = i.title || "Unnamed";
      if (!projMap[p]) projMap[p] = { clips: [], lastDate: i.updatedAt || i.createdAt || "", ideas: [i] };
      else if (!projMap[p].ideas) projMap[p].ideas = [i];
    });

    const projects = Object.entries(projMap)
      .filter(([name]) => name !== "Untagged" || projMap["Untagged"]?.clips?.length)
      .sort((a, b) => (b[1].lastDate || "").localeCompare(a[1].lastDate || ""));

    if (!projects.length) {
      grid.innerHTML = `<p class="db-empty">No projects yet.</p>`;
      return;
    }

    grid.innerHTML = projects.map(([name, data]) => {
      const clipCount = data.clips.length;
      const thumb     = data.clips[0]?.url || "";
      const lastActive = (data.lastDate || "").slice(0, 10);
      const ideaStatus = data.ideas?.[0]?.status || "";

      return `
        <div class="db-proj-card">
          ${thumb
            ? `<video class="db-proj-thumb" src="${_esc(thumb)}" muted preload="none"
                onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0"></video>`
            : `<div class="db-proj-thumb db-proj-no-thumb"><span>No clips</span></div>`
          }
          <div class="db-proj-info">
            <span class="db-proj-name">${_esc(name)}</span>
            <div class="db-proj-meta">
              <span>${clipCount} clip${clipCount !== 1 ? "s" : ""}</span>
              ${ideaStatus ? `${_statusBadge(ideaStatus)}` : ""}
              ${lastActive ? `<span class="db-proj-date">Last: ${lastActive}</span>` : ""}
            </div>
          </div>
        </div>`;
    }).join("");
  }

  // ── Quick action nav ──────────────────────────────────────────
  window.dbGoToIdea = function (id) {
    if (window.switchTab) window.switchTab("idea-vault");
    if (window.ivOpenIdea) window.ivOpenIdea(id);
  };

  window.dbOpenClip = function (url) {
    const modal = document.getElementById("db-clip-modal");
    const vid   = document.getElementById("db-clip-modal-video");
    if (modal && vid) {
      vid.src = url;
      vid.play();
      modal.style.display = "flex";
    } else {
      window.open(url, "_blank");
    }
  };

  window.dbCloseClip = function () {
    const modal = document.getElementById("db-clip-modal");
    const vid   = document.getElementById("db-clip-modal-video");
    if (modal) modal.style.display = "none";
    if (vid) { vid.pause(); vid.src = ""; }
  };

  // ── Helpers ───────────────────────────────────────────────────
  function _setStat(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "—";
  }

  function _statusBadge(status) {
    const map = {
      raw:       ["db-badge-raw",      "Raw"],
      developed: ["db-badge-dev",      "Story Built"],
      approved:  ["db-badge-approved", "Approved"],
      animating: ["db-badge-active",   "Animating"],
      done:      ["db-badge-done",     "Done"],
      failed:    ["db-badge-failed",   "Failed"],
    };
    const [cls, label] = map[status] || ["db-badge-raw", status];
    return `<span class="db-badge ${cls}">${label}</span>`;
  }

  function _elapsedLabel(iso) {
    const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60)  return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    return `${Math.round(sec / 3600)}h`;
  }

  function _esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

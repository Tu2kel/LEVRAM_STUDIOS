// ── Redlight Mode — toggle, glitter, model routing ───────────────────────────
window.RL = (function () {
  const STORAGE_KEY = "rl_mode";
  let active = false;
  let animFrame = null;

  // ── Glitter particle system ────────────────────────────────────────────────
  const canvas  = document.getElementById("rl-glitter");
  const ctx     = canvas ? canvas.getContext("2d") : null;
  let particles = [];

  const COLORS = [
    "#ff1a3a", "#ff4060", "#cc0022", "#ff6688",
    "#ff2244", "#ffaaaa", "#dd0033", "#ff88aa",
    "#ffffff", "#ffcccc",
  ];

  function resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawnParticle() {
    return {
      x:       Math.random() * window.innerWidth,
      y:       window.innerHeight + 10,
      size:    Math.random() * 5 + 2,
      speedY:  -(Math.random() * 2.5 + 1.2),
      speedX:  (Math.random() - 0.5) * 1.2,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.18,
      opacity:  Math.random() * 0.7 + 0.3,
      color:    COLORS[Math.floor(Math.random() * COLORS.length)],
      shape:    Math.random() > 0.5 ? "square" : "diamond",
      twinkle:  Math.random() * Math.PI * 2,
    };
  }

  function drawParticle(p) {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = p.opacity * (0.7 + 0.3 * Math.sin(p.twinkle));
    ctx.fillStyle   = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);

    if (p.shape === "diamond") {
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.6, 0);
      ctx.lineTo(0, p.size);
      ctx.lineTo(-p.size * 0.6, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }

    ctx.restore();
  }

  function tick() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Spawn new particles
    if (particles.length < 120) {
      for (let i = 0; i < 3; i++) particles.push(spawnParticle());
    }

    // Update + draw
    particles = particles.filter(p => p.y > -20 && p.opacity > 0.02);
    for (const p of particles) {
      p.x       += p.speedX;
      p.y       += p.speedY;
      p.rotation += p.rotSpeed;
      p.twinkle  += 0.07;
      p.opacity  -= 0.003;
      drawParticle(p);
    }

    animFrame = requestAnimationFrame(tick);
  }

  function startGlitter() {
    if (!canvas || !ctx) return;
    canvas.style.display = "block";
    resize();
    particles = [];
    if (animFrame) cancelAnimationFrame(animFrame);
    tick();
  }

  function stopGlitter() {
    if (!canvas) return;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = "none";
    particles = [];
  }

  window.addEventListener("resize", () => { if (active) resize(); });

  // ── Model routing ──────────────────────────────────────────────────────────
  // Default model IDs for Redlight mode
  const RL_IMG_MODEL = "ws_flux_uncensored";
  const RL_I2V_MODEL = "ws_wan22_spicy";

  // Normal-mode defaults to restore on toggle off
  const NORMAL_IMG_MODEL = "ws_flux";
  const NORMAL_I2V_MODEL = "ws_wan22";

  function applyModels(imgModel, i2vModel) {
    const imgSel = document.getElementById("ig-engine-toggle");
    if (imgSel) {
      imgSel.querySelectorAll(".cl-vtoggle-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.engine === imgModel);
      });
      // Persist to any engine hidden inputs image-gen.js reads
      if (typeof igSetEngine === "function") igSetEngine(imgModel);
    }

    // I2V model selects — show/hide RL-only options then set value
    const isRL = i2vModel === RL_I2V_MODEL;
    ["ig-i2v-model", "orch-model", "iv-model", "qs-model"].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.querySelectorAll(".rl-only").forEach(o => { o.style.display = isRL ? "" : "none"; });
      const opt = sel.querySelector(`option[value="${i2vModel}"]`);
      if (opt) sel.value = i2vModel;
    });
  }

  // ── Data reload — refresh all list views after studio switch ──────────────
  function reloadAll() {
    // Fire after a short delay so levFetch header is already updated
    setTimeout(() => {
      // Characters
      if (typeof loadCharacters === "function") loadCharacters();
      if (typeof ivLoadCharacters === "function") ivLoadCharacters();
      // Ideas
      if (typeof ivLoadIdeas === "function") ivLoadIdeas();
      // Image gallery
      if (typeof igLoadGallery === "function") igLoadGallery();
      // Render queue
      if (typeof loadRenderQueue === "function") loadRenderQueue();
      // Video gallery
      if (typeof igLoadVideoGallery === "function") igLoadVideoGallery();
      // Dashboard
      if (typeof dbLoad === "function") dbLoad();
    }, 60);
  }

  // ── Body class + button state ──────────────────────────────────────────────
  function setActive(on) {
    active = on;
    document.body.classList.toggle("redlight-mode", on);
    const btn = document.getElementById("rl-toggle-btn");
    if (btn) {
      btn.classList.toggle("rl-active", on);
      btn.textContent = on ? "🔴 Redlight ON" : "🔴 Redlight";
    }
    if (on) { startGlitter(); applyModels(RL_IMG_MODEL, RL_I2V_MODEL); }
    else     { stopGlitter();  applyModels(NORMAL_IMG_MODEL, NORMAL_I2V_MODEL); }
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    reloadAll();
    document.dispatchEvent(new Event("rl-mode-changed"));
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function toggle() { setActive(!active); }
  function isActive() { return active; }

  // Restore on page load — use window.load so all scripts + canvas are ready
  window.addEventListener("load", () => {
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      setTimeout(() => setActive(true), 120);
    }
  });

  return { toggle, isActive };
})();

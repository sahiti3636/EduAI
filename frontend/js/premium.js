// ═══════════════════════════════════════════════════════════════════════════
// MindForge — PREMIUM interaction engine
// Loaded after each page's own script. Pure enhancement layer:
// 3-D tilt, scroll reveal, cursor aurora, confetti, Pomodoro ring widget,
// achievement / quiz / session-end celebrations. No feature logic lives here.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer  = window.matchMedia("(pointer: fine)").matches;

  // ── 3-D tilt engine ─────────────────────────────────────────
  const TILT_SELECTOR = [
    ".glass-card", ".subtopic-tile", ".chapter-card", ".welcome-action-link",
    ".rpt-achievement-card", ".pair-lobby-card", ".rpt-stat", ".progress-stat-card",
  ].join(",");
  const MAX_TILT = 11; // degrees

  function attachTilt(el) {
    if (el.dataset.pvTilt || el.closest(".chat-messages-wrap")) return;
    el.dataset.pvTilt = "1";
    el.classList.add("pv-tilt");

    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--pv-mx", `${px * 100}%`);
      el.style.setProperty("--pv-my", `${py * 100}%`);
      if (reduceMotion) return;
      const rx = (0.5 - py) * MAX_TILT;
      const ry = (px - 0.5) * MAX_TILT;
      el.style.transform =
        `perspective(800px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px) scale3d(1.015, 1.015, 1.015)`;
    });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    });
  }

  function scanTilt(root) {
    if (!finePointer) return;
    (root || document).querySelectorAll(TILT_SELECTOR).forEach(attachTilt);
  }

  // ── Scroll reveal ───────────────────────────────────────────
  // Synchronous viewport sweep (mutation/scroll-driven) instead of
  // IntersectionObserver: IO callbacks can be starved on busy main
  // threads (e.g. WebGL shader compile), which would leave in-view
  // content invisible. A sweep is immediate and cheap.
  function scanReveal(root) {
    (root || document)
      .querySelectorAll(".glass-card, .subtopic-tile, .chapter-card, .welcome-action-link, .rpt-section")
      .forEach((el) => {
        // Above-the-fold landing content must be visible instantly
        if (el.classList.contains("auth-card")) return;
        if (el.dataset.pvReveal || el.closest(".chat-messages-wrap")) return;
        el.dataset.pvReveal = "1";
        el.classList.add("pv-reveal");
      });
    sweepReveal();
  }

  function sweepReveal() {
    // Fail open: if the environment reports no viewport height, treat every
    // sized element as visible — never leave content hidden.
    const vh = innerHeight || document.documentElement.clientHeight || Infinity;
    let i = 0;
    document.querySelectorAll(".pv-reveal:not(.pv-in)").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;      // hidden container
      if (r.top >= vh * 0.96 || r.bottom <= 0) return;  // below/above fold
      setTimeout(() => el.classList.add("pv-in"), Math.min(i++ * 70, 350));
    });
  }

  let sweepScheduled = false;
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    requestAnimationFrame(() => { sweepScheduled = false; sweepReveal(); });
  }
  window.addEventListener("scroll", scheduleSweep, { passive: true });
  window.addEventListener("resize", scheduleSweep);

  // Re-scan when pages inject or show content (all pages render via JS)
  const mo = new MutationObserver(() => { scanTilt(); scanReveal(); });

  // ── Cursor aurora ───────────────────────────────────────────
  function initCursorGlow() {
    if (!finePointer || reduceMotion) return;
    const glow = document.createElement("div");
    glow.id = "pv-cursor-glow";
    document.body.appendChild(glow);
    let raf = null;
    window.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        glow.style.left = e.clientX + "px";
        glow.style.top  = e.clientY + "px";
        raf = null;
      });
    }, { passive: true });
  }

  // ── Background depth parallax (blobs drift toward the cursor) ─
  function initParallax() {
    if (!finePointer || reduceMotion) return;
    const blobs = document.querySelectorAll(".mesh-bg .blob");
    if (!blobs.length) return;
    const depths = [0.030, 0.022, 0.016, 0.011, 0.026];
    let raf = null;
    window.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const dx = e.clientX - innerWidth / 2;
        const dy = e.clientY - innerHeight / 2;
        blobs.forEach((b, i) => {
          const d = depths[i % depths.length];
          b.style.translate = `${dx * d}px ${dy * d}px`;
        });
        raf = null;
      });
    }, { passive: true });
  }

  // ── Confetti engine ─────────────────────────────────────────
  const COLORS = ["#22d3ee", "#818cf8", "#e879f9", "#fb923c", "#34d399", "#ffffff"];

  function confetti(opts) {
    if (reduceMotion) return;
    const { count = 90, spread = 1, origin = 0.35 } = opts || {};
    let canvas = document.getElementById("pv-confetti");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "pv-confetti";
      document.body.appendChild(canvas);
    }
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const ctx = canvas.getContext("2d");

    const parts = Array.from({ length: count }, () => ({
      x: innerWidth * (0.5 + (Math.random() - 0.5) * 0.28 * spread),
      y: innerHeight * origin,
      vx: (Math.random() - 0.5) * 13 * spread,
      vy: -(6 + Math.random() * 9),
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      shape: Math.random() < 0.25 ? "circle" : "rect",
    }));

    const t0 = performance.now();
    (function frame(t) {
      const dt = Math.min((t - t0) / 1600, 1);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.32;                       // gravity
        p.vx *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.y < canvas.height + 30) alive = true;
        ctx.save();
        ctx.globalAlpha = 1 - dt * dt;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (alive && dt < 1) requestAnimationFrame(frame);
      else canvas.remove();
    })(t0);
  }

  // ── Pomodoro ring widget ────────────────────────────────────
  // chat.js drives #pomodoro-timer (textContent "Focus MM:SS" + inline display +
  // .pomodoro-break class). We mirror it into a floating conic-ring widget.
  function initPomodoro() {
    const src = document.getElementById("pomodoro-timer");
    if (!src) return;

    const widget = document.createElement("div");
    widget.id = "pv-pomodoro";
    widget.innerHTML =
      '<div class="pv-pomo-ring"></div>' +
      '<div class="pv-pomo-core">' +
      '  <span class="pv-pomo-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg></span>' +
      '  <span class="pv-pomo-time">--:--</span>' +
      '  <span class="pv-pomo-label">focus</span>' +
      "</div>";
    document.body.appendChild(widget);

    const iconEl = widget.querySelector(".pv-pomo-icon");
    const timeEl = widget.querySelector(".pv-pomo-time");
    const lblEl  = widget.querySelector(".pv-pomo-label");

    let phaseTotal = null;      // seconds in current phase
    let lastSecs   = null;
    let lastBreak  = null;

    function showPhaseOverlay(isBreak) {
      let ov = document.getElementById("pv-phase-overlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "pv-phase-overlay";
        document.body.appendChild(ov);
      }
      ov.innerHTML = isBreak
        ? '<span class="pv-phase-icon"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg></span><span class="pv-phase-title">Break time</span><span class="pv-phase-sub">Stretch, breathe — you earned it.</span>'
        : '<span class="pv-phase-icon"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg></span><span class="pv-phase-title">Focus time</span><span class="pv-phase-sub">Back to it — one step at a time.</span>';
      ov.classList.add("show");
      if (isBreak) confetti({ count: 50, spread: 0.8 });
      setTimeout(() => ov.classList.remove("show"), 2600);
    }

    function sync() {
      const visible = src.style.display !== "none";
      widget.classList.toggle("pv-live", visible);
      if (!visible) { phaseTotal = null; lastSecs = null; lastBreak = null; return; }

      const m = src.textContent.match(/(\d{2}):(\d{2})/);
      if (!m) return;
      const secs = parseInt(m[1]) * 60 + parseInt(m[2]);
      const isBreak = src.classList.contains("pomodoro-break");

      // Phase started or flipped → reset ring baseline
      if (phaseTotal === null || (lastSecs !== null && secs > lastSecs) || isBreak !== lastBreak) {
        phaseTotal = Math.max(secs, 1);
        if (lastBreak !== null && isBreak !== lastBreak) showPhaseOverlay(isBreak);
      }
      lastSecs = secs; lastBreak = isBreak;

      widget.classList.toggle("pv-break", isBreak);
      iconEl.innerHTML = isBreak ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg>';
      lblEl.textContent  = isBreak ? "break" : "focus";
      timeEl.textContent = `${m[1]}:${m[2]}`;
      widget.querySelector(".pv-pomo-ring").style.setProperty(
        "--pv-pct", ((secs / phaseTotal) * 100).toFixed(1));
    }

    new MutationObserver(sync).observe(src, {
      characterData: true, childList: true, subtree: true,
      attributes: true, attributeFilter: ["style", "class"],
    });
    sync();
  }

  // ── Celebration hooks (wrap page globals if present) ────────
  function initHooks() {
    // Achievement unlock → confetti burst per badge
    if (typeof window.showAchievementToast === "function") {
      const orig = window.showAchievementToast;
      window.showAchievementToast = function (details) {
        (details || []).forEach((_, i) =>
          setTimeout(() => confetti({ count: 110, spread: 1.15, origin: 0.55 }), i * 700 + 150));
        return orig.apply(this, arguments);
      };
    }
    // Session notes shown (session completed) → gentle confetti
    if (typeof window.showSessionNotes === "function") {
      const orig = window.showSessionNotes;
      window.showSessionNotes = function () {
        confetti({ count: 55, spread: 0.7, origin: 0.45 });
        return orig.apply(this, arguments);
      };
    }
    // Quiz results → celebrate great scores
    const quizResults = document.getElementById("quiz-results");
    if (quizResults) {
      new MutationObserver(() => {
        if (quizResults.style.display === "none" || quizResults.dataset.pvDone) return;
        const txt = (document.getElementById("result-score-text") || {}).textContent || "";
        const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
        if (!m) return;
        quizResults.dataset.pvDone = "1";
        const pct = (parseInt(m[1]) / Math.max(parseInt(m[2]), 1)) * 100;
        if (pct >= 80)      confetti({ count: 160, spread: 1.4, origin: 0.4 });
        else if (pct >= 50) confetti({ count: 60,  spread: 0.8, origin: 0.4 });
      }).observe(quizResults, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
    }
  }

  // ── Boot ────────────────────────────────────────────────────
  function boot() {
    initCursorGlow();
    initParallax();
    initPomodoro();
    initHooks();
    scanTilt();
    scanReveal();
    // attributes:true so style/display toggles (page-state switches) trigger a sweep
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Expose for manual use / future features
  window.PV = { confetti };
})();

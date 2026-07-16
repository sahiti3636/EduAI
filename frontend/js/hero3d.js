// ═══════════════════════════════════════════════════════════════════════════
// MindForge — WebGL 3-D hero  (index.html landing only)
// An education scene: a swirling vortex of pencils orbiting a chalk-scribbled
// blackboard, with floating books & chalk. Driven by SCROLL (assemble as you
// scroll), plus continuous time animation and pointer parallax.
// Pauses when the tab is hidden or the landing is dismissed. Skips on
// prefers-reduced-motion / no WebGL.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const mount = document.getElementById("hero-3d");
  if (!mount || typeof THREE === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 0.5, 10.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  const CENTER_X = -0.3;

  // ── Materials ───────────────────────────────────────────────
  const woodMat     = new THREE.MeshStandardMaterial({ color: 0xd9b382, roughness: 0.7, metalness: 0.05 });
  const graphiteMat = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.5, metalness: 0.2 });
  const ferruleMat  = new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.35, metalness: 0.85 });
  const eraserMat   = new THREE.MeshStandardMaterial({ color: 0xf7a6b8, roughness: 0.8, metalness: 0.0 });
  const bodyColors  = [0xf5c518, 0xf5c518, 0xf5c518, 0x8b5cf6, 0x4cd7f6, 0xfb7185, 0x34d399, 0xf5c518];

  // ── A single pencil (long axis = +Y, centred near origin) ────
  function buildPencil(color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.12 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 2.0, 6), bodyMat);
    g.add(body);

    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.092, 0.34, 6), woodMat);
    wood.position.y = 1.17; g.add(wood);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 8), graphiteMat);
    tip.position.y = 1.4; g.add(tip);

    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.096, 0.096, 0.16, 12), ferruleMat);
    ferrule.position.y = -1.08; g.add(ferrule);

    const eraser = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.12, 12), eraserMat);
    eraser.position.y = -1.22; g.add(eraser);

    g.scale.setScalar(0.58);   // smaller, subtler pencils
    return g;
  }

  // ── Vortex of pencils ───────────────────────────────────────
  const swirl = new THREE.Group();
  swirl.position.x = CENTER_X;
  scene.add(swirl);

  const N = 16;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const angle = t * Math.PI * 6.0;             // ~3 turns
    const radius = 2.05 - t * 0.45 + Math.sin(t * 9) * 0.1;
    const y = (t - 0.5) * 4.8;
    const p = buildPencil(bodyColors[i % bodyColors.length]);
    p.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

    // orient along the helix tangent → tornado of pencils
    const tangent = new THREE.Vector3(
      -Math.sin(angle) * radius,
      5.4 / N * 3.0,
      Math.cos(angle) * radius
    ).normalize();
    p.quaternion.setFromUnitVectors(up, tangent);
    p.userData.spin = 0.2 + Math.random() * 0.3;
    swirl.add(p);
  }

  // ── Blackboard with chalk scribbles ─────────────────────────
  const board = new THREE.Group();
  board.position.set(CENTER_X, -1.4, -2.2);
  board.rotation.x = -0.22;
  scene.add(board);

  const slate = new THREE.Mesh(
    new THREE.BoxGeometry(5.0, 3.1, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x0f2a24, roughness: 0.95, metalness: 0.0 })
  );
  board.add(slate);

  // wooden frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb5895a, roughness: 0.75 });
  const fr = [
    [5.3, 0.24, 0.16, 0, 1.6, 0.02], [5.3, 0.24, 0.16, 0, -1.6, 0.02],
    [0.24, 3.44, 0.16, -2.6, 0, 0.02], [0.24, 3.44, 0.16, 2.6, 0, 0.02],
  ];
  fr.forEach(([w, h, d, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z); board.add(m);
  });

  // chalk drawing on a canvas → texture on a front plane
  const cv = document.createElement("canvas");
  cv.width = 1024; cv.height = 640;
  const cx = cv.getContext("2d");
  cx.strokeStyle = "rgba(233,238,247,0.72)";
  cx.fillStyle = "rgba(233,238,247,0.72)";
  cx.lineWidth = 4; cx.lineCap = "round";
  cx.font = "600 74px 'Plus Jakarta Sans', sans-serif";
  cx.fillText("x² − 5x + 6 = 0", 90, 150);
  cx.font = "600 62px 'Plus Jakarta Sans', sans-serif";
  cx.fillText("∑", 120, 330); cx.fillText("π", 250, 330); cx.fillText("√", 360, 330);
  cx.fillText("sin θ", 520, 320);
  // a triangle
  cx.beginPath(); cx.moveTo(760, 380); cx.lineTo(980, 380); cx.lineTo(910, 210); cx.closePath(); cx.stroke();
  // a sine wave
  cx.beginPath();
  for (let x = 80; x < 620; x += 6) {
    const yy = 500 + Math.sin((x - 80) / 46) * 44;
    x === 80 ? cx.moveTo(x, yy) : cx.lineTo(x, yy);
  }
  cx.stroke();
  const chalkTex = new THREE.CanvasTexture(cv);
  const chalk = new THREE.Mesh(
    new THREE.PlaneGeometry(4.7, 2.9),
    new THREE.MeshBasicMaterial({ map: chalkTex, transparent: true, opacity: 0.9, depthWrite: false })
  );
  chalk.position.z = 0.07; board.add(chalk);

  // ── Floating books & chalk sticks ───────────────────────────
  const extras = [];
  const bookCovers = [0x8b5cf6, 0x4cd7f6, 0xfb7185];
  bookCovers.forEach((c, i) => {
    const bk = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.8),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.13, 0.72),
      new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9 }));
    pages.position.y = 0.005; bk.add(cover); bk.add(pages);
    bk.position.set(CENTER_X + (i - 1) * 2.6, -2.3 + i * 0.4, 1.2 - i * 0.8);
    bk.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.5);
    bk.userData.phase = Math.random() * Math.PI * 2;
    scene.add(bk); extras.push(bk);
  });
  for (let i = 0; i < 3; i++) {
    const chalkStick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0xf3f4f8, roughness: 0.9 })
    );
    chalkStick.position.set(CENTER_X + (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4, 1 + Math.random());
    chalkStick.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    chalkStick.userData.phase = Math.random() * Math.PI * 2;
    scene.add(chalkStick); extras.push(chalkStick);
  }

  // ── Lighting ────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x2a3757, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-4, 6, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
  fill.position.set(5, -2, 4); scene.add(fill);
  const lights = [
    { light: new THREE.PointLight(0x8b5cf6, 70), speed: 0.42, radius: 5.0, phase: 0 },
    { light: new THREE.PointLight(0x4cd7f6, 52), speed: -0.3, radius: 4.6, phase: 2.1 },
    { light: new THREE.PointLight(0xffb869, 40), speed: 0.22, radius: 5.6, phase: 4.2 },
  ];
  lights.forEach((l) => scene.add(l.light));

  // ── Pointer parallax ────────────────────────────────────────
  let targetX = 0, targetY = 0, curX = 0, curY = 0;
  window.addEventListener("pointermove", (e) => {
    targetX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // ── Scroll progress (0 at top → 1 fully scrolled) ───────────
  let scrollP = 0;
  function readScroll() {
    const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    scrollP = Math.min(Math.max(y / max, 0), 1);
  }
  window.addEventListener("scroll", readScroll, { passive: true });
  readScroll();

  // ── Sizing ──────────────────────────────────────────────────
  function resize() {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener("resize", resize);

  // ── Pause when hidden / landing dismissed ───────────────────
  const landing = document.getElementById("landing-state");
  function isLandingVisible() { return !landing || getComputedStyle(landing).display !== "none"; }
  let running = isLandingVisible();
  document.addEventListener("visibilitychange", () => { running = !document.hidden && isLandingVisible(); });
  if (landing) new MutationObserver(() => {
    const vis = isLandingVisible();
    mount.style.display = vis ? "" : "none";
    running = vis && !document.hidden;
  }).observe(landing, { attributes: true, attributeFilter: ["style"] });
  mount.style.display = isLandingVisible() ? "" : "none";

  // ── Render loop ─────────────────────────────────────────────
  const clock = new THREE.Clock();
  const ease = (a, b, t) => a + (b - a) * t;
  (function animate() {
    requestAnimationFrame(animate);
    if (!running) return;
    const t = clock.getElapsedTime();
    const p = scrollP;

    // vortex spins with time; scroll adds a strong turn and tightens it
    swirl.rotation.y = t * 0.28 + p * Math.PI * 1.4;
    swirl.rotation.z = Math.sin(t * 0.2) * 0.05 - p * 0.12;
    swirl.scale.setScalar(ease(1, 0.82, p));
    swirl.position.y = ease(0, 0.5, p);
    swirl.children.forEach((pen, i) => { pen.rotation.y += 0.004 * pen.userData.spin; });

    // blackboard rises & tilts up into frame as you scroll
    board.position.y = ease(-1.4, 0.2, p);
    board.position.z = ease(-2.2, -0.6, p);
    board.rotation.x = ease(-0.22, -0.02, p);
    board.rotation.y = Math.sin(t * 0.15) * 0.04;

    // floating extras bob
    extras.forEach((e, i) => {
      e.rotation.y += 0.003; e.rotation.x += 0.0015;
      e.position.y += Math.sin(t * 0.8 + e.userData.phase) * 0.0016;
    });

    // orbiting colored lights
    for (const { light, speed, radius, phase } of lights) {
      light.position.set(
        CENTER_X + Math.cos(t * speed + phase) * radius,
        Math.sin(t * speed * 0.8 + phase) * radius * 0.6,
        Math.sin(t * speed + phase) * radius * 0.5 + 2.5
      );
    }

    // camera dolly in + pointer parallax
    curX += (targetX - curX) * 0.045;
    curY += (targetY - curY) * 0.045;
    camera.position.x = CENTER_X * 0.4 + curX * 0.9;
    camera.position.y = ease(0.5, 1.1, p) - curY * 0.6;
    camera.position.z = ease(10.6, 8.4, p);
    camera.lookAt(CENTER_X, ease(0, 0.2, p), 0);

    renderer.render(scene, camera);
  })();
})();

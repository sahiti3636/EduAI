// ── DOM refs ─────────────────────────────────────────────────
const landingState     = document.getElementById("landing-state");
const welcomeState     = document.getElementById("welcome-state");
const setupError       = document.getElementById("setup-error");
const headerGuest      = document.getElementById("header-guest");
const headerStudent    = document.getElementById("header-student");
const headerStudentLbl = document.getElementById("header-student-label");
const subtopicsEl      = document.getElementById("subtopics");

// Icon + description per subtopic
const SUBTOPIC_META = {
  algebra:      { icon: "∑",  desc: "Equations, quadratics, structure" },
  trigonometry: { icon: "△",  desc: "Ratios, identities, geometry" },
  probability:  { icon: "◈",  desc: "Chance, counting, reasoning" },
};
const ICON_CLASS = {
  algebra:      "icon-algebra",
  trigonometry: "icon-trig",
  probability:  "icon-prob",
};

// ── Tab switching ─────────────────────────────────────────────
document.getElementById("tab-login").addEventListener("click", () => {
  document.getElementById("panel-login").style.display    = "";
  document.getElementById("panel-register").style.display = "none";
  document.getElementById("tab-login").classList.add("auth-tab-active");
  document.getElementById("tab-register").classList.remove("auth-tab-active");
  setupError.textContent = "";
});

document.getElementById("tab-register").addEventListener("click", () => {
  document.getElementById("panel-login").style.display    = "none";
  document.getElementById("panel-register").style.display = "";
  document.getElementById("tab-register").classList.add("auth-tab-active");
  document.getElementById("tab-login").classList.remove("auth-tab-active");
  setupError.textContent = "";
});

// ── Login ─────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  setupError.textContent = "";

  if (!username || !password) {
    setupError.textContent = "Please enter your username and password.";
    return;
  }
  try {
    const { student_id, username: uname } = await Api.studentLogin(username, password);
    Store.studentId    = student_id;
    Store.studentLabel = uname;
    showWelcome();
  } catch (e) {
    setupError.textContent = e.message;
  }
}

document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("login-password").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

// ── Register ──────────────────────────────────────────────────
async function doRegister() {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirm  = document.getElementById("reg-confirm").value;
  setupError.textContent = "";

  if (!username || !password || !confirm) {
    setupError.textContent = "Please fill in all fields.";
    return;
  }
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    setupError.textContent = "Username must be 2–30 characters: letters, numbers, _ or -.";
    return;
  }
  if (password.length < 6) {
    setupError.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (password !== confirm) {
    setupError.textContent = "Passwords don't match.";
    return;
  }
  try {
    const { student_id, username: uname } = await Api.register(username, password);
    Store.studentId    = student_id;
    Store.studentLabel = uname;
    showWelcome();
  } catch (e) {
    setupError.textContent = e.message;
  }
}

document.getElementById("register-btn").addEventListener("click", doRegister);
document.getElementById("reg-confirm").addEventListener("keydown", e => {
  if (e.key === "Enter") doRegister();
});

// ── Subject tiles ─────────────────────────────────────────────
async function renderSubtopics() {
  subtopicsEl.innerHTML = "";
  let buckets = [];
  if (Store.studentId) {
    try { buckets = await Api.getStudentBuckets(Store.studentId); }
    catch (e) { console.warn("Could not load buckets:", e); }
  }
  const bucketMap = Object.fromEntries(buckets.map(b => [b.subtopic, b.bucket]));

  SUBTOPICS.forEach(s => {
    const meta   = SUBTOPIC_META[s.id] || {};
    const bucket = bucketMap[s.id];
    const tile   = document.createElement("div");
    tile.className = "subtopic-tile glass-card";

    tile.innerHTML = `
      <div class="tile-icon ${ICON_CLASS[s.id] || ''}">${meta.icon || "?"}</div>
      <div class="tile-name">${s.label}</div>
      <div class="tile-status">
        ${bucket
          ? `<span class="bucket-badge bucket-${bucket}">Level ${bucket}</span>`
          : `<span style="color:var(--text-lo);font-size:.76rem;">Not yet assessed</span>`}
        <div style="margin-top:4px;font-size:.75rem;color:var(--text-lo);">${meta.desc || ""}</div>
      </div>
      <div class="tile-actions">
        <button class="btn btn-ghost btn-sm" data-action="diagnostic" data-subtopic="${s.id}">
          ${bucket ? "Retake diagnostic" : "Start diagnostic"}
        </button>
        ${bucket
          ? `<button class="btn btn-primary btn-sm" data-action="tutor" data-subtopic="${s.id}">
               Start tutoring
             </button>`
          : ""}
      </div>
    `;
    subtopicsEl.appendChild(tile);
  });

  subtopicsEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "diagnostic") {
        window.location.href = `diagnostic.html?subtopic=${btn.dataset.subtopic}`;
      } else {
        window.location.href = `chat.html?subtopic=${btn.dataset.subtopic}`;
      }
    });
  });
}

// ── Page state ────────────────────────────────────────────────
function showLanding() {
  landingState.style.display  = "";
  welcomeState.style.display  = "none";
  headerGuest.style.display   = "";
  headerStudent.style.display = "none";
}

function showWelcome() {
  landingState.style.display  = "none";
  welcomeState.style.display  = "flex";
  headerGuest.style.display   = "none";
  headerStudent.style.display = "";
  document.getElementById("welcome-label").textContent = Store.studentLabel;
  headerStudentLbl.textContent = Store.studentLabel;
  renderSubtopics();
}

// ── Sign out ──────────────────────────────────────────────────
document.getElementById("switch-student-btn").addEventListener("click", () => {
  localStorage.removeItem("eduai_student_id");
  localStorage.removeItem("eduai_student_label");
  showLanding();
});

// ── Auto-restore ──────────────────────────────────────────────
if (Store.studentId) {
  showWelcome();
}

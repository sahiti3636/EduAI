// ── DOM refs ─────────────────────────────────────────────────
const landingState     = document.getElementById("landing-state");
const welcomeState     = document.getElementById("welcome-state");
const setupCard        = document.getElementById("setup-card");      // kept for API compat
const welcomeCard      = document.getElementById("welcome-card");
const subtopicsEl      = document.getElementById("subtopics");
const setupError       = document.getElementById("setup-error");
const headerGuest      = document.getElementById("header-guest");
const headerStudent    = document.getElementById("header-student");
const headerStudentLbl = document.getElementById("header-student-label");

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

async function renderSubtopics() {
  subtopicsEl.innerHTML = "";
  let buckets = [];
  if (Store.studentId) {
    try { buckets = await Api.getStudentBuckets(Store.studentId); }
    catch (e) { console.warn("Could not load buckets:", e); }
  }
  const bucketMap = Object.fromEntries(buckets.map((b) => [b.subtopic, b.bucket]));

  SUBTOPICS.forEach((s) => {
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
          : `<span style="color:var(--text-lo);font-size:.76rem;">Not yet assessed</span>`
        }
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

  subtopicsEl.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "diagnostic") {
        window.location.href = `diagnostic.html?subtopic=${btn.dataset.subtopic}`;
      } else {
        window.location.href = `chat.html?subtopic=${btn.dataset.subtopic}`;
      }
    });
  });
}

// ── Switch between the two page states ───────────────────────
function showLanding() {
  landingState.style.display = "";
  welcomeState.style.display = "none";
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

// ── Events ───────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", async () => {
  const label = document.getElementById("label-input").value.trim();
  setupError.textContent = "";
  if (!label) { setupError.textContent = "Please enter a nickname."; return; }

  try {
    const student = await Api.createStudent(label);
    Store.studentId    = student.id;
    Store.studentLabel = student.label;
    showWelcome();
  } catch (e) {
    setupError.textContent = e.message;
  }
});

document.getElementById("label-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("start-btn").click();
});

document.getElementById("switch-student-btn").addEventListener("click", () => {
  localStorage.removeItem("eduai_student_id");
  localStorage.removeItem("eduai_student_label");
  showLanding();
});

// ── Auto-restore session ─────────────────────────────────────
if (Store.studentId) {
  showWelcome();
}

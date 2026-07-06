// ── Daily Challenge Page ──────────────────────────────────────

let currentSubtopic = null;
let challengeData = null;

function el(id) { return document.getElementById(id); }

// ── Populate subtopic picker ──────────────────────────────────
function buildPicker() {
  const grid = el("subtopic-picker");
  SUBTOPICS.forEach(s => {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost daily-subtopic-btn";
    btn.dataset.subtopic = s.id;
    btn.textContent = s.label;
    btn.addEventListener("click", () => loadChallenge(s.id));
    grid.appendChild(btn);
  });
}

// ── Load challenge for subtopic ───────────────────────────────
async function loadChallenge(subtopicId) {
  currentSubtopic = subtopicId;
  el("daily-error").textContent = "";
  el("subtopic-picker").style.display = "none";
  el("challenge-card").style.display = "block";

  el("challenge-problem").textContent = "Loading today's challenge…";
  el("challenge-actions").style.display = "none";
  el("completed-msg").style.display = "none";
  el("challenge-subtopic-badge").textContent =
    SUBTOPICS.find(s => s.id === subtopicId)?.label || subtopicId;

  try {
    challengeData = await Api.getDailyChallenge(subtopicId, Store.studentId);
    el("challenge-problem").innerHTML = safeMathHTML(challengeData.problem_text);
    if (typeof renderMath === "function") renderMath(el("challenge-problem"));

    if (challengeData.completed) {
      el("challenge-status").textContent = "✓ Done today";
      el("challenge-status").className = "daily-status daily-done";
      el("challenge-actions").style.display = "none";
      el("completed-msg").style.display = "block";
    } else {
      el("challenge-status").textContent = "New today";
      el("challenge-status").className = "daily-status daily-new";
      el("challenge-actions").style.display = "flex";
    }
  } catch (e) {
    el("challenge-problem").textContent = "";
    el("daily-error").textContent = e.message;
    el("challenge-actions").style.display = "none";
  }
}

// ── Start tutoring with challenge problem ─────────────────────
el("start-challenge-btn").addEventListener("click", () => {
  if (!challengeData || !currentSubtopic) return;
  const params = new URLSearchParams({
    subtopic: currentSubtopic,
    problem: challengeData.problem_text,
    daily: "1",
  });
  window.location.href = `chat.html?${params}`;
});

el("pick-another-btn").addEventListener("click", () => {
  el("subtopic-picker").style.display = "";
  el("challenge-card").style.display = "none";
  currentSubtopic = null;
});

// ── Show streak badge ─────────────────────────────────────────
async function loadStreak() {
  if (!Store.studentId) return;
  try {
    const { streak_days } = await Api.getDailyStreak(Store.studentId);
    if (streak_days > 0) {
      const badge = el("streak-badge");
      badge.textContent = `🔥 ${streak_days} day streak`;
      badge.style.display = "";
    }
  } catch (_) {}
}

// ── Auto-load from URL param ──────────────────────────────────
function init() {
  el("today-date").textContent = new Date().toLocaleDateString("en-IN", { dateStyle: "medium" });

  if (!Store.studentId) {
    el("daily-error").textContent = "Sign in on the home page first.";
    return;
  }

  buildPicker();
  loadStreak();

  const params = new URLSearchParams(location.search);
  const subtopic = params.get("subtopic");
  if (subtopic && SUBTOPICS.find(s => s.id === subtopic)) {
    loadChallenge(subtopic);
  }
}

init();

// ── State ─────────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const subtopic = params.get("subtopic");
let sessionId  = null;
let selectedChapterId    = null;
let selectedChapterLabel = null;

if (!Store.studentId) window.location.href = "index.html";

// ── DOM refs ──────────────────────────────────────────────────
const pickerScreen  = document.getElementById("picker-screen");
const chatScreen    = document.getElementById("chat-screen");
const chapterGrid   = document.getElementById("chapter-grid");
const pickerError   = document.getElementById("picker-error");
const chatWindow    = document.getElementById("chat-window");
const chatError     = document.getElementById("chat-error");
const problemHeader = document.getElementById("problem-header");
const problemText   = document.getElementById("problem-text-content");

// ── Step 1 — Build the chapter picker ─────────────────────────
async function loadPicker() {
  const subtopicLabel = (SUBTOPICS.find(s => s.id === subtopic) || {}).label || subtopic;
  document.getElementById("page-title").textContent = `${subtopicLabel} — Choose a chapter`;

  try {
    const chapters = await Api.getChapters(subtopic);

    // Clear the loading placeholder
    chapterGrid.innerHTML = "";

    if (!chapters || chapters.length === 0) {
      chapterGrid.innerHTML = `<p style="color:var(--text-mid);font-size:.85rem;">No chapters found for this subject.</p>`;
      return;
    }

    chapters.forEach(ch => {
      const card = document.createElement("div");
      card.className = "glass-card chapter-card";
      card.innerHTML = `
        <div class="chapter-name">${ch.label}</div>
        <div class="chapter-desc">${ch.description}</div>
        <button class="btn btn-primary btn-sm chapter-btn" style="margin-top:auto;">
          Start with overview →
        </button>
      `;
      card.querySelector(".chapter-btn").addEventListener("click", () => {
        startWithChapter(ch.id, ch.label);
      });
      chapterGrid.appendChild(card);
    });

  } catch (e) {
    chapterGrid.innerHTML = `<p class="error" style="grid-column:1/-1;">Could not load chapters: ${e.message}</p>`;
  }
}

// ── Step 2a — Start from a chapter ────────────────────────────
async function startWithChapter(chapterId, chapterLabel) {
  selectedChapterId    = chapterId;
  selectedChapterLabel = chapterLabel;
  await beginSession({ subSubtopicId: chapterId, chapterLabel });
}

// ── Step 2b — Start from a custom question ────────────────────
document.getElementById("custom-start-btn").addEventListener("click", async () => {
  const problem = document.getElementById("custom-problem").value.trim();
  if (!problem) {
    pickerError.textContent = "Please type or paste a question first.";
    return;
  }
  pickerError.textContent = "";
  await beginSession({ problemStatement: problem, chapterLabel: "Custom Question" });
});

// ── Core: start a tutor session ───────────────────────────────
async function beginSession({ subSubtopicId = null, problemStatement = null, chapterLabel = "" } = {}) {
  pickerError.textContent = "";
  const subtopicLabel = (SUBTOPICS.find(s => s.id === subtopic) || {}).label || subtopic;

  try {
    const turn = await Api.startSession(Store.studentId, subtopic, { subSubtopicId, problemStatement });
    sessionId = turn.session_id;

    // Switch screens
    pickerScreen.style.display = "none";
    chatScreen.style.display   = "flex";

    // Update header labels
    document.getElementById("chat-title").textContent =
      `${subtopicLabel}${chapterLabel ? " — " + chapterLabel : ""}`;

    const badge = document.getElementById("bucket-badge");
    badge.style.display   = "";
    badge.textContent     = `Level ${turn.bucket_used}`;
    badge.className       = `bucket-badge bucket-${turn.bucket_used}`;

    // Show pinned problem card only when there's a real problem statement
    if (turn.problem_text) {
      problemText.textContent = turn.problem_text;
      problemHeader.style.display = "block";
    }

    appendMessage("tutor", turn.reply);
  } catch (e) {
    pickerError.textContent =
      e.message + " — make sure you've completed the diagnostic for this subject first.";
  }
}

// ── Back to picker ────────────────────────────────────────────
document.getElementById("back-to-picker").addEventListener("click", (e) => {
  e.preventDefault();
  chatScreen.style.display  = "none";
  pickerScreen.style.display = "block";
  chatWindow.innerHTML = "";
  problemHeader.style.display = "none";
  problemText.textContent = "";
  document.getElementById("chat-error").textContent = "";
  sessionId = null;
});

// ── Chat: send a message ──────────────────────────────────────
function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className   = `msg ${role}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function send() {
  const input = document.getElementById("chat-input");
  const text  = input.value.trim();
  if (!text || !sessionId) return;

  appendMessage("student", text);
  input.value = "";
  chatError.textContent = "";

  try {
    const turn = await Api.sendMessage(sessionId, text);
    appendMessage("tutor", turn.reply);
    if (turn.rebucket_suggested) {
      const badge = document.getElementById("bucket-badge");
      badge.textContent = `Level ${turn.rebucket_suggested} (updated)`;
      badge.className   = `bucket-badge bucket-${turn.rebucket_suggested}`;
    }
  } catch (e) {
    chatError.textContent = e.message;
  }
}

document.getElementById("send-btn").addEventListener("click", send);
document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

// ── Feedback ratings ──────────────────────────────────────────
document.querySelectorAll("[data-rating]").forEach(btn => {
  btn.addEventListener("click", async () => {
    try {
      await Api.logMetric(Store.studentId, subtopic, "bucket_felt_right_student", btn.dataset.rating);
      btn.textContent = "Thanks!";
      btn.disabled = true;
    } catch (e) {
      chatError.textContent = e.message;
    }
  });
});

// ── Boot ──────────────────────────────────────────────────────
loadPicker();

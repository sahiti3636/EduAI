// ── One-question-at-a-time diagnostic flow ───────────────────
// Fetches all items once, stores answers per item_id, and renders
// one card at a time with progress bar + prev/next navigation.

const params     = new URLSearchParams(window.location.search);
const subtopic   = params.get("subtopic");
const questionArea = document.getElementById("question-area");
const progressRow  = document.getElementById("progress-row");
const progressLbl  = document.getElementById("progress-label");
const progressFill = document.getElementById("progress-fill");
const errorEl      = document.getElementById("diag-error");

if (!Store.studentId) window.location.href = "index.html";

// ── State ────────────────────────────────────────────────────
let questions = [];   // [{id, type, prompt}, ...]
let currentIdx = 0;   // which question is on screen
const answers = {};   // {item_id: string}

// ── Human-readable type labels ────────────────────────────────
const TYPE_LABELS = {
  "explain-first-step":    "Explain Your Approach",
  "find-the-error":        "Find the Error",
  "solve-and-show-working":"Solve & Show Working",
  "choose-between-methods":"Choose Your Method",
};

// ── Load questions from API ───────────────────────────────────
async function load() {
  try {
    const data = await Api.getDiagnostic(subtopic);
    questions = data.items;

    document.getElementById("page-title").textContent =
      `${data.label} — Diagnostic`;
    document.getElementById("subtopic-badge").textContent = data.label;

    progressRow.style.display = "";
    renderQuestion(0);
  } catch (e) {
    errorEl.textContent = e.message;
  }
}

// ── Render question at index ──────────────────────────────────
function renderQuestion(idx) {
  // Save whatever is currently typed (if a question is already shown)
  saveCurrentAnswer();
  currentIdx = idx;

  const item  = questions[idx];
  const total = questions.length;
  const pct   = Math.round(((idx + 1) / total) * 100);

  // Update progress UI
  progressLbl.textContent = `Question ${idx + 1} of ${total}`;
  progressFill.style.width = `${pct}%`;

  const typeLabel = TYPE_LABELS[item.type] || item.type.replace(/-/g, " ");
  const isLast    = idx === total - 1;
  const savedVal  = answers[item.id] || "";

  questionArea.innerHTML = `
    <div class="glass-card question-card" id="active-question">

      <!-- Meta row: number chip + type tag -->
      <div class="q-meta">
        <div class="q-num">${idx + 1}</div>
        <span class="q-type-tag">${typeLabel}</span>
      </div>

      <!-- Question text -->
      <div class="q-prompt" id="q-prompt-text"></div>

      <!-- Answer input -->
      <p class="q-answer-label">Your answer &amp; reasoning</p>
      <textarea
        class="form-textarea q-textarea"
        id="q-answer"
        placeholder="Write your reasoning here — explain HOW you'd approach this, not just the final answer…"
      >${escHtml(savedVal)}</textarea>

      <!-- Navigation row -->
      <div class="q-nav">
        <div class="q-nav-left">
          ${idx > 0
            ? `<button class="btn btn-ghost btn-sm" id="prev-btn">← Previous</button>`
            : `<span></span>`}
        </div>
        <div class="q-nav-right">
          ${isLast
            ? `<button class="btn btn-primary" id="submit-btn">Submit diagnostic</button>`
            : `<button class="btn btn-primary btn-sm" id="next-btn">Next →</button>`}
        </div>
      </div>

    </div>
  `;

  // Set prompt text safely (preserves newlines without risking XSS)
  document.getElementById("q-prompt-text").textContent = item.prompt;

  // Restore scroll + focus
  questionArea.scrollIntoView({ behavior: "smooth", block: "start" });
  const ta = document.getElementById("q-answer");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  // Wire navigation buttons
  document.getElementById("prev-btn")?.addEventListener("click", () => {
    renderQuestion(idx - 1);
  });
  document.getElementById("next-btn")?.addEventListener("click", () => {
    renderQuestion(idx + 1);
  });
  document.getElementById("submit-btn")?.addEventListener("click", submit);
}

// ── Save the current textarea value into answers{} ───────────
function saveCurrentAnswer() {
  const ta = document.getElementById("q-answer");
  if (ta && questions[currentIdx]) {
    answers[questions[currentIdx].id] = ta.value;
  }
}

// ── Submit all answers ────────────────────────────────────────
async function submit() {
  saveCurrentAnswer();
  errorEl.textContent = "";

  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Analysing…"; }

  try {
    const result = await Api.submitDiagnostic(subtopic, Store.studentId, answers);

    // Hide question area + progress
    questionArea.style.display = "none";
    progressRow.style.display  = "none";

    // Show result card
    const resultCard = document.getElementById("result-card");
    resultCard.style.display = "block";

    const bucketEl = document.getElementById("result-bucket");
    bucketEl.textContent = result.bucket;

    document.getElementById("result-rationale").textContent = result.rationale;

    document.getElementById("go-tutor-btn").addEventListener("click", () => {
      window.location.href = `chat.html?subtopic=${subtopic}`;
    });
  } catch (e) {
    errorEl.textContent = e.message;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit diagnostic"; }
  }
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

load();

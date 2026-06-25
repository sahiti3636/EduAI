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
    startTimer();
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

      <!-- Input toolbar -->
      <div class="q-input-toolbar">
        <button class="btn btn-ghost btn-xs math-kb-btn math-kb-btn-inline" id="q-kb-btn" title="Math keyboard">
          <svg viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="10">
            <rect x="1" y="1" width="20" height="12" rx="2"/>
            <circle cx="5" cy="6" r=".9" fill="currentColor" stroke="none"/>
            <circle cx="8.5" cy="6" r=".9" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="6" r=".9" fill="currentColor" stroke="none"/>
            <circle cx="15.5" cy="6" r=".9" fill="currentColor" stroke="none"/>
            <rect x="7" y="9.5" width="8" height="1.5" rx=".75" fill="currentColor" stroke="none"/>
          </svg>
          Math keyboard
        </button>
        <button class="mic-btn mic-btn-inline" id="q-mic-btn" title="Speak your answer" aria-label="Voice input">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path d="M10 1a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/>
            <path d="M5 9a1 1 0 0 0-2 0 7 7 0 0 0 6 6.93V17H7a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-1.07A7 7 0 0 0 17 9a1 1 0 0 0-2 0 5 5 0 0 1-10 0Z"/>
          </svg>
        </button>
        <label class="btn btn-ghost btn-xs ocr-upload-label math-kb-btn" for="q-ocr-input" title="Attach image of your question or working">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="15">
            <rect x="2" y="4" width="16" height="12" rx="2"/>
            <circle cx="7" cy="9" r="1.5"/>
            <path d="M2 14l4-4 3 3 3-3 4 4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Attach image
        </label>
        <input type="file" id="q-ocr-input" accept="image/*" style="display:none"/>
        <span class="ocr-status" id="q-ocr-status" style="display:none"></span>
      </div>
      <div class="ocr-preview" id="q-ocr-preview" style="display:none">
        <img id="q-ocr-thumb" class="ocr-thumb" alt="Uploaded question"/>
        <button class="ocr-remove" id="q-ocr-remove" title="Remove image">✕</button>
      </div>

      <!-- Live math preview -->
      <div class="math-preview" id="q-math-preview">
        <div class="math-preview-label">Preview</div>
        <div class="math-preview-body"></div>
      </div>

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
  const promptEl = document.getElementById("q-prompt-text");
  promptEl.innerHTML = safeMathHTML(item.prompt);
  renderMath(promptEl);

  // Restore scroll + focus
  questionArea.scrollIntoView({ behavior: "smooth", block: "start" });
  const ta = document.getElementById("q-answer");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  // Wire live math preview for the answer textarea
  attachMathPreview(ta, null, document.getElementById("q-math-preview"));

  // Wire navigation buttons
  document.getElementById("prev-btn")?.addEventListener("click", () => {
    renderQuestion(idx - 1);
  });
  document.getElementById("next-btn")?.addEventListener("click", () => {
    renderQuestion(idx + 1);
  });
  document.getElementById("submit-btn")?.addEventListener("click", submit);

  // Wire math keyboard (ta already declared above for focus/scroll)
  document.getElementById("q-kb-btn").addEventListener("click", () => {
    mathKb.attach(ta);
  });

  // Wire voice input
  (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.getElementById("q-mic-btn");
    if (!SR) { micBtn.style.display = "none"; return; }
    const rec = new SR();
    rec.lang = "en-IN"; rec.continuous = false; rec.interimResults = true;
    let listening = false;
    micBtn.addEventListener("click", () => listening ? rec.stop() : rec.start());
    rec.onstart  = () => { listening = true;  micBtn.classList.add("mic-active"); };
    rec.onend    = () => { listening = false; micBtn.classList.remove("mic-active"); };
    rec.onerror  = () => rec.onend();
    rec.onresult = (e) => {
      ta.value = Array.from(e.results).map(r => r[0].transcript).join("");
      if (e.results[e.results.length - 1].isFinal) rec.stop();
    };
  })();

  // Wire OCR
  (() => {
    const fileInput = document.getElementById("q-ocr-input");
    const status    = document.getElementById("q-ocr-status");
    const preview   = document.getElementById("q-ocr-preview");
    const thumb     = document.getElementById("q-ocr-thumb");
    const removeBtn = document.getElementById("q-ocr-remove");

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      thumb.src = URL.createObjectURL(file);
      preview.style.display = "flex";
      status.textContent = "Extracting text…";
      status.className = "ocr-status ocr-loading";
      status.style.display = "inline";
      try {
        const { text } = await Api.extractFromImage(file);
        const existing = ta.value.trim();
        ta.value = existing ? existing + "\n" + text : text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        status.textContent = "Text extracted — edit if needed.";
        status.className = "ocr-status ocr-ok";
      } catch (e) {
        status.textContent = e.message;
        status.className = "ocr-status ocr-err";
        preview.style.display = "none";
        URL.revokeObjectURL(thumb.src);
      }
      fileInput.value = "";
    });

    removeBtn.addEventListener("click", () => {
      URL.revokeObjectURL(thumb.src);
      thumb.src = "";
      preview.style.display = "none";
      status.style.display = "none";
    });
  })();
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

    clearInterval(timerInterval);
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

// ── Soft countdown timer (20 min, non-blocking) ───────────────
const DIAG_SECONDS = 20 * 60;
let timerEl       = null;
let timerInterval = null;
let secondsLeft   = DIAG_SECONDS;

function startTimer() {
  timerEl = document.getElementById("diag-timer");
  if (!timerEl) return;
  timerInterval = setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    const m = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
    const s = (secondsLeft % 60).toString().padStart(2, "0");
    timerEl.textContent = `${m}:${s}`;
    if (secondsLeft <= 300) timerEl.classList.add("timer-warn");   // last 5 min
    if (secondsLeft <= 60)  timerEl.classList.add("timer-urgent"); // last 1 min
    if (secondsLeft === 0)  clearInterval(timerInterval);
  }, 1000);
}

load();

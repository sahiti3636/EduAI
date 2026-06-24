// ── State ─────────────────────────────────────────────────────
if (!Store.studentId) window.location.href = "index.html";

const subtopic      = sessionStorage.getItem("eduai_quiz_subtopic");
const chapterId     = sessionStorage.getItem("eduai_quiz_chapter_id");
const chapterLabel  = sessionStorage.getItem("eduai_quiz_chapter_label") || "Chapter Quiz";

if (!subtopic || !chapterId) window.location.href = "index.html";

let quizId    = null;
let attemptId = null;
let questions = [];        // QuizQuestionPublic[]
let answers   = {};        // {q_id: string}
let currentIdx = 0;
let flashcards  = [];
let fcIdx       = 0;

// ── DOM refs ──────────────────────────────────────────────────
const loadingEl      = document.getElementById("quiz-loading");
const questionsEl    = document.getElementById("quiz-questions");
const resultsEl      = document.getElementById("quiz-results");
const revisionEl     = document.getElementById("quiz-revision");

const progressFill   = document.getElementById("quiz-progress-fill");
const progressText   = document.getElementById("quiz-progress-text");
const qNum           = document.getElementById("quiz-q-num");
const qTypeBadge     = document.getElementById("quiz-q-type");
const qText          = document.getElementById("quiz-q-text");
const optionsEl      = document.getElementById("quiz-options");
const shortEl        = document.getElementById("quiz-short");
const shortInput     = document.getElementById("quiz-short-input");
const prevBtn        = document.getElementById("quiz-prev-btn");
const nextBtn        = document.getElementById("quiz-next-btn");
const submitBtn      = document.getElementById("quiz-submit-btn");
const qError         = document.getElementById("quiz-q-error");

// ── Helpers ───────────────────────────────────────────────────
function showScreen(id) {
  ["quiz-loading","quiz-questions","quiz-results","quiz-revision"].forEach(sid => {
    document.getElementById(sid).style.display = sid === id ? "" : "none";
  });
}

function updateProgress() {
  const pct = ((currentIdx + 1) / questions.length) * 100;
  progressFill.style.width = pct + "%";
  progressText.textContent = `${currentIdx + 1} / ${questions.length}`;
}

// ── Render one question ───────────────────────────────────────
function renderQuestion(idx) {
  const q = questions[idx];
  currentIdx = idx;

  qNum.textContent       = `Question ${idx + 1}`;
  qTypeBadge.textContent = q.type === "mcq" ? "Multiple choice" : "Short answer";
  qText.textContent      = q.question;
  renderMath(qText);
  qError.textContent    = "";

  // MCQ vs short answer
  if (q.type === "mcq") {
    optionsEl.style.display = "";
    shortEl.style.display   = "none";
    optionsEl.innerHTML     = "";

    (q.options || []).forEach(opt => {
      const letter = opt.charAt(0);  // "A", "B", "C"
      const btn = document.createElement("button");
      btn.className = "quiz-option-btn" + (answers[q.id] === letter ? " selected" : "");
      btn.textContent = opt;
      renderMath(btn);
      btn.addEventListener("click", () => {
        answers[q.id] = letter;
        optionsEl.querySelectorAll(".quiz-option-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      optionsEl.appendChild(btn);
    });
  } else {
    optionsEl.style.display = "none";
    shortEl.style.display   = "";
    shortInput.value        = answers[q.id] || "";
    // Save on input
    shortInput.oninput = () => { answers[q.id] = shortInput.value; };
  }

  // Nav buttons
  prevBtn.disabled = idx === 0;
  const isLast = idx === questions.length - 1;
  nextBtn.style.display   = isLast ? "none" : "";
  submitBtn.style.display = isLast ? "" : "none";

  updateProgress();
}

// ── Boot: load quiz ───────────────────────────────────────────
async function loadQuiz() {
  document.getElementById("quiz-chapter-label").textContent = chapterLabel;
  document.getElementById("quiz-loading-msg").textContent = "Generating your quiz…";
  showScreen("quiz-loading");

  // Show bucket badge if available
  try {
    const buckets = await Api.getStudentBuckets(Store.studentId);
    const entry = (buckets || []).find(b => b.subtopic === subtopic);
    if (entry) {
      const badge = document.getElementById("bucket-badge");
      badge.textContent = `Level ${entry.bucket}`;
      badge.className   = `bucket-badge bucket-${entry.bucket}`;
      badge.style.display = "";
    }
  } catch (_) {}

  try {
    const data = await Api.generateQuiz(Store.studentId, subtopic, chapterId, chapterLabel);
    quizId    = data.quiz_id;
    questions = data.questions;
    answers   = {};
    renderQuestion(0);
    showScreen("quiz-questions");
  } catch (e) {
    document.getElementById("quiz-loading-msg").textContent = "Error: " + e.message;
  }
}

// ── Navigation ────────────────────────────────────────────────
prevBtn.addEventListener("click", () => {
  if (currentIdx > 0) renderQuestion(currentIdx - 1);
});

nextBtn.addEventListener("click", () => {
  // Save short-answer text before moving
  const q = questions[currentIdx];
  if (q.type === "short") answers[q.id] = shortInput.value;
  if (currentIdx < questions.length - 1) renderQuestion(currentIdx + 1);
});

// ── Submit quiz ───────────────────────────────────────────────
submitBtn.addEventListener("click", async () => {
  // Save last short-answer input
  const q = questions[currentIdx];
  if (q.type === "short") answers[q.id] = shortInput.value;

  // Require at least an attempt at every question
  const unanswered = questions.filter(q => !answers[q.id] || !answers[q.id].trim());
  if (unanswered.length > 0) {
    qError.textContent = `Please answer all questions before submitting (${unanswered.length} remaining).`;
    return;
  }
  qError.textContent = "";

  document.getElementById("quiz-loading-msg").textContent = "Evaluating your answers…";
  showScreen("quiz-loading");

  try {
    const data = await Api.submitQuiz(quizId, Store.studentId, answers);
    attemptId = data.attempt_id;
    renderResults(data, questions);
    showScreen("quiz-results");
  } catch (e) {
    document.getElementById("quiz-loading-msg").textContent = "Error submitting quiz: " + e.message;
  }
});

// ── Render results ────────────────────────────────────────────
function renderResults(data, qs) {
  const { score, total, results } = data;
  const pct = Math.round((score / total) * 100);

  // Score ring colour
  const ring = document.getElementById("result-score-ring");
  ring.style.setProperty("--score-pct", pct + "%");
  ring.style.setProperty("--ring-color",
    pct >= 80 ? "rgba(34,197,94,0.9)"
    : pct >= 50 ? "rgba(234,179,8,0.9)"
    : "rgba(239,68,68,0.9)"
  );
  document.getElementById("result-score-text").textContent = `${score}/${total}`;
  document.getElementById("result-title").textContent =
    pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort!" : "Keep practising!";
  document.getElementById("result-subtitle").textContent =
    `You scored ${score} out of ${total} — ${pct}%`;

  // Per-question results
  const list = document.getElementById("results-list");
  list.innerHTML = "";
  const qMap = Object.fromEntries(qs.map(q => [q.id, q]));

  results.forEach((r, i) => {
    const orig = qMap[r.question_id];
    const card = document.createElement("div");
    card.className = "glass-card result-item " + (r.correct ? "result-correct" : r.partial ? "result-partial" : "result-wrong");
    const questionText   = orig ? orig.question : "";
    const feedbackText   = r.feedback;
    const explanText     = r.explanation;
    card.innerHTML = `
      <div class="result-item-header">
        <span class="result-item-num">Q${i + 1}</span>
        <span class="result-item-status">${r.correct ? "✓ Correct" : r.partial ? "~ Partial" : "✗ Incorrect"}</span>
      </div>
      <p class="result-item-question"></p>
      <p class="result-item-feedback"></p>
      ${!r.correct ? `<details class="result-explanation"><summary>See full explanation</summary><p class="expl-body"></p></details>` : ""}
    `;
    card.querySelector(".result-item-question").textContent = questionText;
    card.querySelector(".result-item-feedback").textContent = feedbackText;
    if (!r.correct) card.querySelector(".expl-body").textContent = explanText;
    renderMath(card);
    list.appendChild(card);
  });
}

// ── Quiz feedback rating ──────────────────────────────────────
document.querySelectorAll("[data-quiz-rating]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const text = document.getElementById("quiz-feedback-text").value.trim() || null;
    try {
      await Api.logMetric(Store.studentId, subtopic, "quiz_difficulty_felt", btn.dataset.quizRating, text);
      btn.textContent = "Thanks!";
      btn.disabled = true;
      if (text) {
        document.getElementById("quiz-feedback-text").value = "";
        document.getElementById("quiz-feedback-sent").style.display = "inline";
      }
    } catch (_) {}
  });
});

document.getElementById("quiz-feedback-btn").addEventListener("click", async () => {
  const text = document.getElementById("quiz-feedback-text").value.trim();
  if (!text) return;
  try {
    await Api.logMetric(Store.studentId, subtopic, "quiz_written_feedback", "submitted", text);
    document.getElementById("quiz-feedback-text").value = "";
    document.getElementById("quiz-feedback-sent").style.display = "inline";
    document.getElementById("quiz-feedback-btn").disabled = true;
  } catch (_) {}
});

// ── Generate revision sheet ───────────────────────────────────
document.getElementById("revision-btn").addEventListener("click", async () => {
  document.getElementById("revision-error").textContent = "";
  document.getElementById("quiz-loading-msg").textContent = "Building your revision sheet…";
  showScreen("quiz-loading");

  try {
    const data = await Api.getRevision(attemptId);
    renderRevision(data);
    showScreen("quiz-revision");
  } catch (e) {
    showScreen("quiz-results");
    document.getElementById("revision-error").textContent = "Could not generate revision sheet: " + e.message;
  }
});

document.getElementById("back-to-results-btn").addEventListener("click", () => {
  showScreen("quiz-results");
});

// ── Render revision sheet ─────────────────────────────────────
function renderRevision(data) {
  document.getElementById("revision-summary").textContent = data.summary;

  // Weak-area tags
  const weakList = document.getElementById("weak-areas-list");
  weakList.innerHTML = "";
  (data.weak_areas || []).forEach(area => {
    const tag = document.createElement("span");
    tag.className = "weak-area-tag";
    tag.textContent = area;
    weakList.appendChild(tag);
  });

  // Revision points
  const rpList = document.getElementById("revision-points-list");
  rpList.innerHTML = "";
  (data.revision_points || []).forEach(rp => {
    const item = document.createElement("div");
    item.className = "revision-point";
    item.innerHTML = `<strong class="rp-title">${rp.title}</strong><p class="rp-body">${rp.explanation}</p>`;
    rpList.appendChild(item);
  });

  // Flashcards
  flashcards = data.flashcards || [];
  fcIdx = 0;
  renderFlashcard();
}

// ── Flashcard logic ───────────────────────────────────────────
function renderFlashcard() {
  if (!flashcards.length) return;
  const fc = flashcards[fcIdx];
  // Reset to front
  const card = document.getElementById("flashcard");
  card.classList.remove("flipped");
  document.getElementById("fc-front-text").textContent = fc.front;
  document.getElementById("fc-back-text").textContent  = fc.back;
  document.getElementById("fc-counter").textContent    = `${fcIdx + 1} / ${flashcards.length}`;
  document.getElementById("fc-prev").disabled = fcIdx === 0;
  document.getElementById("fc-next").disabled = fcIdx === flashcards.length - 1;
}

document.getElementById("flashcard").addEventListener("click", () => {
  document.getElementById("flashcard").classList.toggle("flipped");
});

document.getElementById("fc-prev").addEventListener("click", () => {
  if (fcIdx > 0) { fcIdx--; renderFlashcard(); }
});

document.getElementById("fc-next").addEventListener("click", () => {
  if (fcIdx < flashcards.length - 1) { fcIdx++; renderFlashcard(); }
});

// ── Math keyboard for short-answer ───────────────────────────
document.getElementById("quiz-kb-btn").addEventListener("click", () => {
  mathKb.attach(shortInput);
});

// ── Voice input for short-answer ─────────────────────────────
(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("quiz-mic-btn");
  if (!SpeechRecognition || !micBtn) return;

  const rec = new SpeechRecognition();
  rec.lang = "en-IN";
  rec.continuous = false;
  rec.interimResults = true;

  let listening = false;

  micBtn.addEventListener("click", () => { listening ? rec.stop() : rec.start(); });
  rec.onstart  = () => { listening = true;  micBtn.classList.add("mic-active"); };
  rec.onend    = () => { listening = false; micBtn.classList.remove("mic-active"); };
  rec.onerror  = () => rec.onend();
  rec.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join("");
    shortInput.value = transcript;
    answers[questions[currentIdx]?.id] = transcript;
    if (e.results[e.results.length - 1].isFinal) rec.stop();
  };
})();

// ── OCR image upload (short-answer questions) ─────────────────
(function () {
  const fileInput = document.getElementById("quiz-ocr-input");
  const status    = document.getElementById("quiz-ocr-status");
  const preview   = document.getElementById("quiz-ocr-preview");
  const thumb     = document.getElementById("quiz-ocr-thumb");
  const removeBtn = document.getElementById("quiz-ocr-remove");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    thumb.src = URL.createObjectURL(file);
    preview.style.display = "flex";

    status.textContent   = "Extracting working…";
    status.className     = "ocr-status ocr-loading";
    status.style.display = "inline";

    try {
      const { text } = await Api.extractFromImage(file);
      // Append to existing answer so student doesn't lose typed work
      const existing = shortInput.value.trim();
      shortInput.value = existing ? existing + "\n" + text : text;
      // Sync to answers map
      const qId = questions[currentIdx]?.id;
      if (qId) answers[qId] = shortInput.value;

      status.textContent = "Working extracted — edit if needed.";
      status.className   = "ocr-status ocr-ok";
    } catch (e) {
      status.textContent  = e.message;
      status.className    = "ocr-status ocr-err";
      preview.style.display = "none";
      URL.revokeObjectURL(thumb.src);
    }

    fileInput.value = "";
  });

  removeBtn.addEventListener("click", () => {
    URL.revokeObjectURL(thumb.src);
    thumb.src = "";
    preview.style.display = "none";
    status.style.display  = "none";
  });
})();

// ── Boot ──────────────────────────────────────────────────────
loadQuiz();

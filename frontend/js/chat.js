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
    const [chapters, progress] = await Promise.all([
      Api.getChapters(subtopic),
      Api.getProgress(Store.studentId).catch(() => null),
    ]);

    // ── Diagnostic gate ────────────────────────────────────
    const subtopicProgress = (progress?.subtopics || []).find(s => s.id === subtopic);
    const hasBucket = !!subtopicProgress?.bucket;

    if (!hasBucket) {
      chapterGrid.innerHTML = "";
      document.getElementById("diag-gate").style.display = "";
      document.getElementById("diag-gate-link").href = `diagnostic.html?subtopic=${subtopic}`;
      // Still allow the custom question card — hide only the chapter grid lock
      return;
    }

    document.getElementById("diag-gate").style.display = "none";

    // Build a set of chapter IDs the student has already quizzed
    const completedChapters = new Set();
    if (progress) {
      (subtopicProgress?.chapters || []).forEach(c => { if (c.completed) completedChapters.add(c.id); });
    }

    chapterGrid.innerHTML = "";

    if (!chapters || chapters.length === 0) {
      chapterGrid.innerHTML = `<p style="color:var(--text-mid);font-size:.85rem;">No chapters found for this subject.</p>`;
      return;
    }

    chapters.forEach(ch => {
      const prereqMissing = ch.prerequisite_id && !completedChapters.has(ch.prerequisite_id);
      const prereqHtml = prereqMissing
        ? `<div class="chapter-prereq">
             Tip: try <strong>${ch.prerequisite_label}</strong> first for best results
           </div>`
        : "";

      const card = document.createElement("div");
      card.className = "glass-card chapter-card";
      card.innerHTML = `
        <div class="chapter-name">${ch.label}</div>
        <div class="chapter-desc">${ch.description}</div>
        ${prereqHtml}
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
      problemText.innerHTML = safeMathHTML(turn.problem_text);
      renderMath(problemText);
      problemHeader.style.display = "block";
    }

    // If this is a chapter session, store info and show the quiz action button
    if (subSubtopicId) {
      sessionStorage.setItem("eduai_quiz_subtopic", subtopic);
      sessionStorage.setItem("eduai_quiz_chapter_id", subSubtopicId);
      sessionStorage.setItem("eduai_quiz_chapter_label", chapterLabel || "");
      document.getElementById("quiz-action").style.display = "block";
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
  div.innerHTML   = safeMathHTML(text);
  chatWindow.appendChild(div);
  renderMath(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function send() {
  const input = document.getElementById("chat-input");
  const text  = input.value.trim();
  if (!text || !sessionId) return;

  appendMessage("student", text);
  input.value = "";
  // Clear the chat math preview
  const chatPreview = document.getElementById("chat-math-preview");
  if (chatPreview) chatPreview.classList.remove("visible");
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
    const textFeedback = document.getElementById("feedback-text").value.trim() || null;
    try {
      await Api.logMetric(Store.studentId, subtopic, "bucket_felt_right_student", btn.dataset.rating, textFeedback);
      btn.textContent = "Thanks!";
      btn.disabled = true;
      if (textFeedback) {
        document.getElementById("feedback-text").value = "";
        document.getElementById("feedback-sent").style.display = "inline";
      }
    } catch (e) {
      chatError.textContent = e.message;
    }
  });
});

// ── Written feedback (standalone submit) ──────────────────────
document.getElementById("feedback-submit-btn").addEventListener("click", async () => {
  const textFeedback = document.getElementById("feedback-text").value.trim();
  if (!textFeedback) return;
  try {
    await Api.logMetric(Store.studentId, subtopic, "session_written_feedback", "submitted", textFeedback);
    document.getElementById("feedback-text").value = "";
    document.getElementById("feedback-sent").style.display = "inline";
    document.getElementById("feedback-submit-btn").disabled = true;
  } catch (e) {
    chatError.textContent = e.message;
  }
});

// ── Voice input ───────────────────────────────────────────────
(function () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("mic-btn");
  if (!SpeechRecognition) { micBtn.style.display = "none"; return; }

  const rec = new SpeechRecognition();
  rec.lang = "en-IN";
  rec.continuous = false;
  rec.interimResults = true;

  let listening = false;
  const input = document.getElementById("chat-input");

  micBtn.addEventListener("click", () => {
    if (listening) { rec.stop(); return; }
    rec.start();
  });

  rec.onstart = () => {
    listening = true;
    micBtn.classList.add("mic-active");
    micBtn.title = "Listening… click to stop";
  };
  rec.onend = () => {
    listening = false;
    micBtn.classList.remove("mic-active");
    micBtn.title = "Speak your answer";
  };
  rec.onerror = () => { rec.onend(); };

  rec.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript).join("");
    input.value = transcript;
    if (e.results[e.results.length - 1].isFinal) rec.stop();
  };
})();

// ── Transcript download ───────────────────────────────────────
document.getElementById("download-transcript-btn").addEventListener("click", () => {
  const msgs = chatWindow.querySelectorAll(".msg");
  if (!msgs.length) return;

  const subtopicLabel = (SUBTOPICS.find(s => s.id === subtopic) || {}).label || subtopic;
  const chapterLabel  = selectedChapterLabel || "Session";
  const date          = new Date().toLocaleDateString("en-IN", { dateStyle: "long" });

  let lines = [
    `EduAI — Tutoring Transcript`,
    `Subject: ${subtopicLabel}${chapterLabel ? " — " + chapterLabel : ""}`,
    `Date: ${date}`,
    `${"─".repeat(50)}`,
    "",
  ];

  msgs.forEach(m => {
    const role = m.classList.contains("tutor") ? "Tutor" : "You";
    lines.push(`[${role}]`);
    lines.push(m.textContent.trim());
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `eduai-transcript-${subtopic}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Math keyboard (chat input) ────────────────────────────────
document.getElementById("chat-kb-btn").addEventListener("click", () => {
  mathKb.attach(document.getElementById("chat-input"));
});

// ── Math keyboard (custom question textarea) ──────────────────
document.getElementById("custom-kb-btn").addEventListener("click", () => {
  mathKb.attach(document.getElementById("custom-problem"));
});

// ── Live math previews ────────────────────────────────────────
attachMathPreview(
  document.getElementById("custom-problem"),
  null,
  document.getElementById("custom-math-preview")
);
attachMathPreview(
  document.getElementById("chat-input"),
  null,
  document.getElementById("chat-math-preview")
);

// ── OCR on chat message input ─────────────────────────────────
(function () {
  const fileInput = document.getElementById("chat-img-input");
  const status    = document.getElementById("chat-ocr-status");
  const chatInput = document.getElementById("chat-input");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    status.textContent   = "Extracting text from image…";
    status.className     = "ocr-status ocr-loading";
    status.style.display = "inline";
    try {
      const { text } = await Api.extractFromImage(file);
      const existing = chatInput.value.trim();
      chatInput.value = existing ? existing + "\n" + text : text;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = "Text extracted — edit if needed.";
      status.className   = "ocr-status ocr-ok";
    } catch (e) {
      status.textContent = e.message;
      status.className   = "ocr-status ocr-err";
    }
    fileInput.value = "";
    setTimeout(() => { status.style.display = "none"; }, 4000);
  });
})();

// ── OCR image upload (custom question) ───────────────────────
(function () {
  const fileInput = document.getElementById("ocr-file-input");
  const status    = document.getElementById("ocr-status");
  const preview   = document.getElementById("ocr-preview");
  const thumb     = document.getElementById("ocr-thumb");
  const removeBtn = document.getElementById("ocr-remove");
  const textarea  = document.getElementById("custom-problem");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Show thumbnail preview
    thumb.src = URL.createObjectURL(file);
    preview.style.display = "flex";

    // Show loading state
    status.textContent = "Extracting text…";
    status.className   = "ocr-status ocr-loading";
    status.style.display = "inline";

    try {
      const { text } = await Api.extractFromImage(file);
      textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent  = "Text extracted — edit if needed.";
      status.className    = "ocr-status ocr-ok";
    } catch (e) {
      status.textContent  = e.message;
      status.className    = "ocr-status ocr-err";
      preview.style.display = "none";
      URL.revokeObjectURL(thumb.src);
    }

    // Reset input so re-uploading same file fires change again
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
loadPicker();

// ── State ─────────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const subtopic = params.get("subtopic");
let sessionId  = null;
let selectedChapterId    = null;
let selectedChapterLabel = null;
let feynmanMode = false;

// ── Pomodoro config (bucket → minutes) ────────────────────────
const POMODORO = {
  A: { work: 45, brk: 10 },
  B: { work: 30, brk: 7  },
  C: { work: 20, brk: 5  },
};
let pomodoroInterval = null;

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

// ── Feynman toggle ────────────────────────────────────────────
document.getElementById("feynman-toggle").addEventListener("change", function () {
  feynmanMode = this.checked;
  const card = document.getElementById("feynman-toggle-card");
  card.classList.toggle("feynman-active", feynmanMode);
});

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
  const mode = feynmanMode ? "feynman" : "socratic";

  try {
    const turn = await Api.startSession(Store.studentId, subtopic, { subSubtopicId, problemStatement, mode });
    sessionId = turn.session_id;

    // Switch screens
    pickerScreen.style.display = "none";
    chatScreen.style.display   = "flex";

    // Update header labels
    const modeTag = mode === "feynman" ? " · Explain Mode" : "";
    document.getElementById("chat-title").textContent =
      `${subtopicLabel}${chapterLabel ? " — " + chapterLabel : ""}${modeTag}`;

    // Update mode note
    const modeNote = document.getElementById("chat-mode-note");
    if (mode === "feynman") {
      modeNote.textContent = "Explain Mode: teach the concept to the AI. It will ask questions when confused — the gaps it finds are the gaps in your understanding.";
    } else {
      modeNote.textContent = "The tutor guides you with questions — ask for the answer directly if you want it, otherwise work through it together. ✦";
    }

    const badge = document.getElementById("bucket-badge");
    badge.style.display   = "";
    badge.textContent     = mode === "feynman" ? "Explain Mode" : `Level ${turn.bucket_used}`;
    badge.className       = `bucket-badge bucket-${turn.bucket_used}`;

    // Show pinned problem card only when there's a real problem statement
    if (turn.problem_text) {
      problemText.innerHTML = safeMathHTML(turn.problem_text);
      renderMath(problemText);
      problemHeader.style.display = "block";
    }

    // If this is a chapter session, store info and show the action buttons
    if (subSubtopicId) {
      sessionStorage.setItem("eduai_quiz_subtopic", subtopic);
      sessionStorage.setItem("eduai_quiz_chapter_id", subSubtopicId);
      sessionStorage.setItem("eduai_quiz_chapter_label", chapterLabel || "");
      document.getElementById("quiz-action").style.display = "block";
      // Hide quiz link in Feynman mode (no quiz from explain sessions)
      document.getElementById("take-quiz-link").style.display =
        mode === "feynman" ? "none" : "";
    }

    appendMessage("tutor", turn.reply);

    // Start adaptive Pomodoro timer
    startPomodoro(turn.bucket_used);
  } catch (e) {
    pickerError.textContent =
      e.message + " — make sure you've completed the diagnostic for this subject first.";
  }
}

// ── Back to picker ────────────────────────────────────────────
document.getElementById("back-to-picker").addEventListener("click", (e) => {
  e.preventDefault();
  stopPomodoro();
  chatScreen.style.display  = "none";
  pickerScreen.style.display = "block";
  chatWindow.innerHTML = "";
  problemHeader.style.display = "none";
  problemText.textContent = "";
  document.getElementById("chat-error").textContent = "";
  document.getElementById("session-notes-card").style.display = "none";
  sessionId = null;
});

// ── End session + generate notes ─────────────────────────────
document.getElementById("end-session-btn").addEventListener("click", async () => {
  if (!sessionId) return;
  const btn = document.getElementById("end-session-btn");
  const generating = document.getElementById("notes-generating");
  btn.disabled = true;
  generating.style.display = "flex";

  const endedSessionId = sessionId; // capture before reset

  try {
    const result = await Api.endSession(endedSessionId);
    stopPomodoro();
    if (result && result.notes && result.notes.student_breakthrough) {
      showSessionNotes(result.notes);
    }
    showFeedbackCard(endedSessionId);
    // Check achievements after session ends
    if (Store.studentId) {
      Api.checkAchievements(Store.studentId).then(r => {
        if (r.newly_awarded && r.newly_awarded.length > 0) {
          showAchievementToast(r.details);
        }
      }).catch(() => {});
    }
  } catch (_) {
    // notes generation failure is non-fatal
  } finally {
    btn.disabled = false;
    generating.style.display = "none";
    btn.textContent = "Session ended";
    btn.disabled = true;
  }
});

function showFeedbackCard(endedId) {
  const existing = document.getElementById("session-feedback-card");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "session-feedback-card";
  card.className = "glass-card session-feedback-card";
  card.innerHTML = `
    <p class="feedback-card-title">How did this session feel?</p>
    <div class="feedback-guidance-row">
      <span class="feedback-q-label">Guidance level</span>
      <div class="feedback-pill-row">
        <button class="feedback-pill" data-val="too_little">Too little</button>
        <button class="feedback-pill" data-val="just_right">Just right</button>
        <button class="feedback-pill" data-val="too_much">Too much</button>
      </div>
    </div>
    <div class="feedback-frust-row">
      <span class="feedback-q-label">Frustration (1 = calm, 5 = very frustrated)</span>
      <div class="feedback-star-row">
        ${[1,2,3,4,5].map(n => `<button class="feedback-star" data-n="${n}">${n}</button>`).join("")}
      </div>
    </div>
    <button class="btn btn-primary btn-sm feedback-submit" id="feedback-submit-btn" style="margin-top:14px;" disabled>
      Submit
    </button>
    <span class="feedback-done" id="feedback-done" style="display:none;color:var(--green);font-size:.8rem;margin-left:10px;">✓ Thanks!</span>
  `;

  let guidance = null, frust = null;

  card.querySelectorAll(".feedback-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      card.querySelectorAll(".feedback-pill").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      guidance = btn.dataset.val;
      maybeEnable();
    });
  });
  card.querySelectorAll(".feedback-star").forEach(btn => {
    btn.addEventListener("click", () => {
      const n = parseInt(btn.dataset.n);
      frust = n;
      card.querySelectorAll(".feedback-star").forEach((b, i) => {
        b.classList.toggle("selected", i < n);
      });
      maybeEnable();
    });
  });

  function maybeEnable() {
    card.querySelector("#feedback-submit-btn").disabled = !(guidance || frust);
  }

  card.querySelector("#feedback-submit-btn").addEventListener("click", async () => {
    card.querySelector("#feedback-submit-btn").disabled = true;
    try {
      await Api.submitFeedback(endedId, Store.studentId, guidance, frust);
      card.querySelector("#feedback-done").style.display = "";
    } catch (_) {}
  });

  const notesCard = document.getElementById("session-notes-card");
  if (notesCard && notesCard.parentNode) {
    notesCard.parentNode.insertBefore(card, notesCard.nextSibling);
  } else {
    document.getElementById("chat-window").after(card);
  }
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showAchievementToast(details) {
  details.forEach((a, i) => {
    setTimeout(() => {
      const toast = document.createElement("div");
      toast.className = "achievement-toast";
      toast.innerHTML = `<span class="ach-toast-icon">${PVIcons.get(a.icon, 26)}</span><div><strong>${a.title}</strong><div class="ach-toast-desc">${a.desc}</div></div>`;
      document.body.appendChild(toast);
      setTimeout(() => toast.classList.add("show"), 50);
      setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 4000);
    }, i * 700);
  });
}

function showSessionNotes(notes) {
  const card = document.getElementById("session-notes-card");
  document.getElementById("notes-breakthrough").textContent = notes.student_breakthrough;

  const metaEl = document.getElementById("notes-meta");
  const topicEl = document.getElementById("notes-topic");
  const struggledEl = document.getElementById("notes-struggled");

  if (notes.topic_covered || notes.struggled_with) {
    topicEl.textContent = notes.topic_covered ? `Topic: ${notes.topic_covered}` : "";
    struggledEl.textContent = notes.struggled_with ? `Trickiest part: ${notes.struggled_with}` : "";
    struggledEl.style.display = notes.struggled_with ? "" : "none";
    metaEl.style.display = "";
  }

  card.style.display = "block";
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Adaptive Pomodoro timer ───────────────────────────────────
function startPomodoro(bucket) {
  stopPomodoro();
  const cfg = POMODORO[bucket] || POMODORO["B"];
  const timerEl = document.getElementById("pomodoro-timer");
  timerEl.style.display = "";

  let phase = "work";          // "work" | "break"
  let secsLeft = cfg.work * 60;

  function tick() {
    if (secsLeft < 0) {
      if (phase === "work") {
        phase = "break";
        secsLeft = cfg.brk * 60;
        timerEl.classList.add("pomodoro-break");
        timerEl.title = "Break time!";
      } else {
        phase = "work";
        secsLeft = cfg.work * 60;
        timerEl.classList.remove("pomodoro-break");
        timerEl.title = "Work session";
      }
    }
    const m = String(Math.floor(secsLeft / 60)).padStart(2, "0");
    const s = String(secsLeft % 60).padStart(2, "0");
    timerEl.textContent = `${phase === "work" ? "Focus" : "Break"} ${m}:${s}`;
    secsLeft--;
  }

  tick();
  pomodoroInterval = setInterval(tick, 1000);
}

function stopPomodoro() {
  if (pomodoroInterval) { clearInterval(pomodoroInterval); pomodoroInterval = null; }
  const timerEl = document.getElementById("pomodoro-timer");
  if (timerEl) timerEl.style.display = "none";
}

// ── Chat: send a message ──────────────────────────────────────
function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className   = `msg ${role}`;

  let processed = text;
  const desmosMatches = [];
  processed = processed.replace(/\[DESMOS:\s*(.*?)\s*\]/g, (m, expr) => {
    const id = "desmos-" + Math.random().toString(36).substr(2, 9);
    desmosMatches.push({ id, expr });
    return `__DESMOS_${id}__`;
  });

  const mermaidMatches = [];
  processed = processed.replace(/```mermaid\n([\s\S]*?)```/g, (m, code) => {
    const id = "mermaid-" + Math.random().toString(36).substr(2, 9);
    mermaidMatches.push({ id, code });
    return `__MERMAID_${id}__`;
  });

  processed = safeMathHTML(processed);

  desmosMatches.forEach(match => {
    processed = processed.replace(`__DESMOS_${match.id}__`, `<div id="${match.id}" style="width:100%; height:300px; margin: 10px 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--glass-border);"></div>`);
  });

  mermaidMatches.forEach(match => {
    processed = processed.replace(`__MERMAID_${match.id}__`, `<div id="${match.id}" class="mermaid" style="background: var(--surface-1); padding: 10px; border-radius: 8px; margin: 10px 0; overflow-x: auto; text-align: center;">${match.code}</div>`);
  });

  div.innerHTML = processed;
  chatWindow.appendChild(div);
  renderMath(div);

  // Initialize Desmos
  if (typeof Desmos !== 'undefined') {
      desmosMatches.forEach(match => {
          const elt = document.getElementById(match.id);
          if (elt) {
              const calc = Desmos.GraphingCalculator(elt, { expressions: false, settingsMenu: false, zoomButtons: true });
              calc.setExpression({ id: 'graph1', latex: match.expr });
          }
      });
  }

  // Initialize Mermaid
  if (typeof mermaid !== 'undefined' && mermaidMatches.length > 0) {
      const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
      mermaid.initialize({ startOnLoad: false, theme: theme });
      mermaid.run({ nodes: mermaidMatches.map(m => document.getElementById(m.id)).filter(Boolean) });
  }

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function send() {
  const input = document.getElementById("chat-input");
  const text  = input.value.trim();
  if (!text || !sessionId) return;

  appendMessage("student", text);
  input.value = "";
  // Hide rendered math if active (function removed)
  // hideRenderedMath(input);
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

document.getElementById("visualize-btn").addEventListener("click", async () => {
  if (!sessionId) return;
  const btn = document.getElementById("visualize-btn");
  btn.disabled = true;
  chatError.textContent = "";
  
  // Show a temporary message to the user
  appendMessage("student", "Please show me a visual explanation of this step.");

  try {
    const turn = await Api.sendMessage(sessionId, "[SYSTEM_VISUALIZE]");
    appendMessage("tutor", turn.reply);
    if (turn.rebucket_suggested) {
      const badge = document.getElementById("bucket-badge");
      badge.textContent = `Level ${turn.rebucket_suggested} (updated)`;
      badge.className   = `bucket-badge bucket-${turn.rebucket_suggested}`;
    }
  } catch (e) {
    chatError.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
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

// ── Live math previews removed; handled directly by showRenderedMath after OCR ──

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
      const formattedText = text; // ensureMathDelimiters removed
      chatInput.value = existing ? existing + "\n" + formattedText : formattedText;
      // if (_hasMathDelimiters(chatInput.value)) {
      //   showRenderedMath(chatInput);
      // }
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
      const formattedText = text; // ensureMathDelimiters removed
      textarea.value = formattedText;
      // if (_hasMathDelimiters(textarea.value)) {
      //   showRenderedMath(textarea);
      // }
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
loadPicker().then(() => {
  // Auto-start when arriving from daily.html with a pre-set problem
  const urlProblem = params.get("problem");
  const isDaily    = params.get("daily") === "1";
  if (urlProblem && isDaily) {
    beginSession({ problemStatement: urlProblem, chapterLabel: "Daily Challenge" }).then(() => {
      // Mark challenge as completed once the session starts
      if (Store.studentId && subtopic) {
        Api.completeDailyChallenge(subtopic, Store.studentId, sessionId).catch(() => {});
      }
    });
  }
});

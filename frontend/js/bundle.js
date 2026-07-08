// Tiny fetch wrapper for the EduAI backend API.
// Change API_BASE if the backend runs on a different host/port.
// Empty string = relative to current origin.
// Override with window.EDUAI_API_BASE = "http://..." before this script loads
// if you ever need to point at a different host.
const API_BASE = window.EDUAI_API_BASE || "";

async function apiRequest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch (_) {
      /* ignore */
    }
    throw new Error(`${method} ${path} failed (${res.status}): ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function _teacherHeaders() {
  const token = sessionStorage.getItem("eduai_teacher_token");
  return token ? { "X-Teacher-Token": token } : {};
}

const Api = {
  // ── Auth ──────────────────────────────────────────────────────
  register: (username, password) =>
    apiRequest("POST", "/auth/register", { username, password }),
  studentLogin: (username, password) =>
    apiRequest("POST", "/auth/login", { username, password }),
  teacherLogin: (username, password) =>
    apiRequest("POST", "/auth/teacher/login", { username, password }),

  // Teacher-gated endpoints (include token header automatically)
  teacherOverview: () =>
    apiRequest("GET", "/teacher/overview", undefined, _teacherHeaders()),
  teacherFeedback: () =>
    apiRequest("GET", "/teacher/written-feedback", undefined, _teacherHeaders()),

  // ── Students ──────────────────────────────────────────────────
  createStudent: (label) => apiRequest("POST", "/students", { label }),
  getStudentBuckets: (studentId) => apiRequest("GET", `/students/${studentId}/buckets`),
  getDiagnostic: (subtopic) => apiRequest("GET", `/diagnostic/${subtopic}`),
  submitDiagnostic: (subtopic, studentId, responses) =>
    apiRequest("POST", `/diagnostic/${subtopic}/submit`, { student_id: studentId, responses }),
  overrideBucket: (studentId, subtopic, bucket, by) =>
    apiRequest("POST", `/students/${studentId}/buckets/${subtopic}/override`, { bucket, by }),
  getChapters: (subtopic) => apiRequest("GET", `/tutor/subtopics/${subtopic}/chapters`),
  startSession: (studentId, subtopic, { problemStatement = null, subSubtopicId = null, mode = "socratic" } = {}) =>
    apiRequest("POST", "/tutor/sessions", {
      student_id: studentId,
      subtopic,
      problem_statement: problemStatement || null,
      sub_subtopic_id: subSubtopicId || null,
      mode,
    }),
  sendMessage: (sessionId, content) =>
    apiRequest("POST", `/tutor/sessions/${sessionId}/messages`, { content }),
  endSession: (sessionId) => apiRequest("POST", `/tutor/sessions/${sessionId}/end`),
  logMetric: (studentId, subtopic, metricType, value, textFeedback = null) =>
    apiRequest("POST", "/metrics", {
      student_id: studentId,
      subtopic,
      metric_type: metricType,
      value,
      text_feedback: textFeedback || null,
    }),

  // Quiz endpoints
  generateQuiz: (studentId, subtopic, subSubtopicId, subSubtopicLabel) =>
    apiRequest("POST", "/quiz/generate", {
      student_id: studentId,
      subtopic,
      sub_subtopic_id: subSubtopicId,
      sub_subtopic_label: subSubtopicLabel,
    }),
  submitQuiz: (quizId, studentId, answers) =>
    apiRequest("POST", "/quiz/submit", { quiz_id: quizId, student_id: studentId, answers }),
  getRevision: (attemptId) =>
    apiRequest("POST", "/quiz/revision", { attempt_id: attemptId }),
  getProgress: (studentId) =>
    apiRequest("GET", `/students/${studentId}/progress`),
  getErrorPatterns: (studentId) =>
    apiRequest("GET", `/students/${studentId}/error-patterns`),
  getDueFlashcards: (studentId) =>
    apiRequest("GET", `/quiz/flashcards/due?student_id=${studentId}`),
  markDeckReviewed: (deckId, rating) =>
    apiRequest("POST", `/quiz/flashcards/${deckId}/reviewed?rating=${rating}`),
  getDueReviews: (studentId) =>
    apiRequest("GET", `/students/${studentId}/due-reviews`),
  getConceptMap: (studentId) =>
    apiRequest("GET", `/students/${studentId}/concept-map`),
  getReport: (studentId) =>
    apiRequest("GET", `/students/${studentId}/report`),

  // Daily challenge
  getDailyChallenge: (subtopic, studentId) =>
    apiRequest("GET", `/daily-challenge/${subtopic}${studentId ? `?student_id=${studentId}` : ""}`),
  completeDailyChallenge: (subtopic, studentId, sessionId = null) =>
    apiRequest("POST", `/daily-challenge/${subtopic}/complete`, { student_id: studentId, session_id: sessionId }),
  getDailyStreak: (studentId) =>
    apiRequest("GET", `/daily-challenge/streak/${studentId}`),

  // Leaderboard
  getLeaderboard: (studentId) =>
    apiRequest("GET", `/leaderboard${studentId ? `?student_id=${studentId}` : ""}`),
  setLeaderboardOpt: (studentId, optedIn) =>
    apiRequest("POST", `/students/${studentId}/leaderboard/opt`, { opted_in: optedIn }),
  getLeaderboardStatus: (studentId) =>
    apiRequest("GET", `/students/${studentId}/leaderboard/status`),

  // Study pair
  createPairRoom: (hostStudentId, subtopic) =>
    apiRequest("POST", "/pair/rooms", { host_student_id: hostStudentId, subtopic }),
  joinPairRoom: (roomId, studentId) =>
    apiRequest("POST", `/pair/rooms/${roomId}/join`, { student_id: studentId }),
  getPairRoom: (roomId) =>
    apiRequest("GET", `/pair/rooms/${roomId}`),

  // ── Phase 4: Feedback ────────────────────────────────────────
  submitFeedback: (sessionId, studentId, guidanceRating, frustrationScore) =>
    apiRequest("POST", `/sessions/${sessionId}/feedback`, {
      student_id: studentId,
      guidance_rating: guidanceRating,
      frustration_score: frustrationScore,
    }),
  getFeedbackSummary: (studentId) =>
    apiRequest("GET", `/students/${studentId}/feedback/summary`),

  // ── Phase 4: Achievements ────────────────────────────────────
  getAchievements: (studentId) =>
    apiRequest("GET", `/students/${studentId}/achievements`),
  checkAchievements: (studentId) =>
    apiRequest("POST", `/students/${studentId}/achievements/check`, {}),

  // ── Phase 4: Teacher — guardrail audit + rater validation ────
  teacherGuardrailAudit: () =>
    apiRequest("GET", "/teacher/guardrail-audit", undefined, _teacherHeaders()),
  teacherSubmitBucketAssessment: (studentId, subtopic, bucket, note) =>
    apiRequest("POST", "/teacher/bucket-assessments",
      { student_id: studentId, subtopic, bucket, note: note || null },
      _teacherHeaders()),
  teacherRaterValidation: () =>
    apiRequest("GET", "/teacher/rater-validation", undefined, _teacherHeaders()),
  teacherStudentsForValidation: () =>
    apiRequest("GET", "/teacher/students-for-validation", undefined, _teacherHeaders()),

  extractFromImage: async (file) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/ocr/extract`, { method: "POST", body: form });
    if (!res.ok) {
      let detail = res.statusText;
      try { const d = await res.json(); detail = d.detail || JSON.stringify(d); } catch (_) {}
      throw new Error(`OCR failed (${res.status}): ${detail}`);
    }
    return res.json();
  },
};

const SUBTOPICS = [
  { id: "algebra", label: "Algebra" },
  { id: "trigonometry", label: "Trigonometry" },
  { id: "probability", label: "Probability" },
];

// Simple session storage helpers (no backend auth for the pilot).
const Store = {
  get studentId() {
    return localStorage.getItem("eduai_student_id");
  },
  set studentId(v) {
    localStorage.setItem("eduai_student_id", v);
  },
  get studentLabel() {
    return localStorage.getItem("eduai_student_label");
  },
  set studentLabel(v) {
    localStorage.setItem("eduai_student_label", v);
  },
};

// ── PVIcons — professional inline SVG icon set (no emojis) ──────
// Usage: PVIcons.get("bell", 18)  →  svg string, stroke = currentColor
const PVIcons = (() => {
  const P = {
    bell:      '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    bolt:      '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    trophy:    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    users:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart:     '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 13l3-3 4 4 5-5"/>',
    document:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>',
    network:   '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5 6 16.5"/><path d="m12 7.5 6 9"/><path d="M7.5 19h9"/>',
    presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    plus:      '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    target:    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    pencil:    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    cards:     '<rect x="2" y="6" width="14" height="16" rx="2"/><path d="M6 2h12a2 2 0 0 1 2 2v14"/>',
    flame:     '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    book:      '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    shield:    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    alert:     '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    user:      '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    cap:       '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M22 10v6"/>',
    medal:     '<circle cx="12" cy="15" r="6"/><path d="M12 12v3l2 1"/><path d="m9 9.5-3-7.5"/><path d="m15 9.5 3-7.5"/>',
    calendar:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    award:     '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    star:      '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    trend:     '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    compass:   '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
    lock:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    timer:     '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    coffee:    '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    check:     '<path d="M20 6 9 17l-5-5"/>',
  };
  return {
    get(name, size = 18) {
      const body = P[name] || P.star;
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    },
  };
})();
// Renders LaTeX math inside a given DOM element using KaTeX auto-render.
// Called after every dynamic content insertion (chat messages, quiz questions, etc.).
// Safe to call before the deferred KaTeX scripts have loaded — renderMathInElement
// will be undefined and we no-op gracefully.
//
// NOTE: The canonical copy of renderMath() + safeMathHTML() lives in bundle.js.
// This file is kept in sync for pages that load katex-render.js separately.
function renderMath(el) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(el, {
    delimiters: [
      { left: "$$", right: "$$", display: true  },
      { left: "\\[", right: "\\]", display: true },
      { left: "$",  right: "$",  display: false },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  });
}

function safeMathHTML(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}
/**
 * MathKeyboard — shared math symbol keyboard for EduAI.
 *
 * Usage:
 *   mathKb.attach(textareaEl)   // open/re-target the keyboard
 *   mathKb.detach()             // close
 *
 * One instance lives on window.mathKb; all pages share it.
 */

const _MATH_KEYS = [
  {
    id: "symbols",
    label: "Symbols",
    keys: [
      { l: "×",   v: "×" },
      { l: "÷",   v: "÷" },
      { l: "±",   v: "±" },
      { l: "=",   v: "=" },
      { l: "≠",   v: "≠",   t: "Not equal" },
      { l: "≤",   v: "≤",   t: "Less than or equal" },
      { l: "≥",   v: "≥",   t: "Greater than or equal" },
      { l: "≈",   v: "≈",   t: "Approximately equal" },
      { l: "∞",   v: "∞",   t: "Infinity" },
      { l: "°",   v: "°",   t: "Degrees" },
      { l: "²",   v: "²",   t: "Squared (superscript)" },
      { l: "³",   v: "³",   t: "Cubed (superscript)" },
      { l: "⁻¹",  v: "⁻¹",  t: "Inverse / reciprocal" },
      { l: "√",   v: "√()", c: 1, t: "Square root" },
      { l: "∛",   v: "∛()", c: 1, t: "Cube root" },
      { l: "xⁿ",  v: "^()", c: 1, t: "Power / exponent" },
      { l: "( )", v: "()",  c: 1, t: "Parentheses" },
      { l: "½",   v: "½" },
      { l: "¼",   v: "¼" },
      { l: "¾",   v: "¾" },
      { l: "⅓",   v: "⅓" },
      { l: "⅔",   v: "⅔" },
      { l: "%",   v: "%" },
      { l: "...", v: "…" },
    ],
  },
  {
    id: "greek",
    label: "Greek",
    keys: [
      { l: "α", v: "α", t: "Alpha" },
      { l: "β", v: "β", t: "Beta" },
      { l: "γ", v: "γ", t: "Gamma" },
      { l: "δ", v: "δ", t: "Delta" },
      { l: "ε", v: "ε", t: "Epsilon" },
      { l: "ζ", v: "ζ", t: "Zeta" },
      { l: "η", v: "η", t: "Eta" },
      { l: "θ", v: "θ", t: "Theta" },
      { l: "λ", v: "λ", t: "Lambda" },
      { l: "μ", v: "μ", t: "Mu" },
      { l: "π", v: "π", t: "Pi" },
      { l: "ρ", v: "ρ", t: "Rho" },
      { l: "σ", v: "σ", t: "Sigma" },
      { l: "φ", v: "φ", t: "Phi" },
      { l: "ω", v: "ω", t: "Omega" },
      { l: "Δ", v: "Δ", t: "Delta (capital)" },
      { l: "Σ", v: "Σ", t: "Sigma (capital)" },
      { l: "Π", v: "Π", t: "Pi (capital)" },
      { l: "Θ", v: "Θ", t: "Theta (capital)" },
      { l: "Ω", v: "Ω", t: "Omega (capital)" },
    ],
  },
  {
    id: "trig",
    label: "Trig",
    keys: [
      { l: "sin",    v: "sin()",    c: 1 },
      { l: "cos",    v: "cos()",    c: 1 },
      { l: "tan",    v: "tan()",    c: 1 },
      { l: "sin⁻¹", v: "sin⁻¹()", c: 1, t: "Arcsine" },
      { l: "cos⁻¹", v: "cos⁻¹()", c: 1, t: "Arccosine" },
      { l: "tan⁻¹", v: "tan⁻¹()", c: 1, t: "Arctangent" },
      { l: "sec",    v: "sec()",    c: 1 },
      { l: "cosec",  v: "cosec()",  c: 1 },
      { l: "cot",    v: "cot()",    c: 1 },
      { l: "90°",   v: "90°" },
      { l: "180°",  v: "180°" },
      { l: "270°",  v: "270°" },
      { l: "360°",  v: "360°" },
      { l: "π/2",   v: "π/2" },
      { l: "π/4",   v: "π/4" },
      { l: "π/6",   v: "π/6" },
    ],
  },
  {
    id: "sets",
    label: "Sets & Prob",
    keys: [
      { l: "∈",    v: "∈",     t: "Element of" },
      { l: "∉",    v: "∉",     t: "Not element of" },
      { l: "⊂",    v: "⊂",     t: "Subset of" },
      { l: "⊄",    v: "⊄",     t: "Not a subset" },
      { l: "∩",    v: "∩",     t: "Intersection" },
      { l: "∪",    v: "∪",     t: "Union" },
      { l: "∅",    v: "∅",     t: "Empty set" },
      { l: "P()",  v: "P()",   c: 1, t: "Probability of" },
      { l: "n!",   v: "n!",    t: "Factorial" },
      { l: "C(,)", v: "C(,)",  c: 2, t: "Combination C(n,r)" },
      { l: "P(,)", v: "P(,)",  c: 2, t: "Permutation P(n,r)" },
      { l: "∴",    v: "∴",     t: "Therefore" },
      { l: "∵",    v: "∵",     t: "Because" },
      { l: "→",    v: "→",     t: "Implies / maps to" },
      { l: "⇒",    v: "⇒",     t: "Implies (strong)" },
      { l: "≡",    v: "≡",     t: "Equivalent" },
    ],
  },
];

class MathKeyboard {
  constructor() {
    this._target  = null;
    this._tab     = "symbols";
    this._panel   = null;
    this._built   = false;
  }

  // ── Public API ───────────────────────────────────────────────

  attach(textarea) {
    if (!this._built) this._build();
    if (this._target === textarea && this._panel.style.display !== "none") {
      this.detach();
      return;
    }
    this._target = textarea;
    this._panel.style.display = "";
    document.body.classList.add("math-kb-open");
  }

  detach() {
    this._panel.style.display = "none";
    document.body.classList.remove("math-kb-open");
    this._target = null;
  }

  // ── Build ────────────────────────────────────────────────────

  _build() {
    const panel = document.createElement("div");
    panel.className = "math-kb-panel";
    panel.style.display = "none";
    panel.setAttribute("role", "toolbar");
    panel.setAttribute("aria-label", "Math keyboard");

    // Header
    const header = document.createElement("div");
    header.className = "math-kb-header";
    header.innerHTML = `
      <span class="math-kb-title">
        <svg viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.6"
             width="20" height="13" style="margin-right:6px;vertical-align:middle;">
          <rect x="1" y="1" width="20" height="12" rx="2"/>
          <circle cx="5" cy="6" r=".8" fill="currentColor" stroke="none"/>
          <circle cx="8.5" cy="6" r=".8" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="6" r=".8" fill="currentColor" stroke="none"/>
          <circle cx="15.5" cy="6" r=".8" fill="currentColor" stroke="none"/>
          <rect x="7" y="9" width="8" height="1.6" rx=".8" fill="currentColor" stroke="none"/>
        </svg>
        Math Keyboard
      </span>
      <div class="math-kb-header-actions">
        <button class="math-kb-bksp" title="Backspace">⌫</button>
        <button class="math-kb-close" title="Close keyboard (Esc)">✕</button>
      </div>
    `;
    panel.appendChild(header);

    // Tabs
    const tabBar = document.createElement("div");
    tabBar.className = "math-kb-tabs";
    _MATH_KEYS.forEach(group => {
      const btn = document.createElement("button");
      btn.className = "math-kb-tab" + (group.id === this._tab ? " math-kb-tab-active" : "");
      btn.dataset.tab = group.id;
      btn.textContent = group.label;
      tabBar.appendChild(btn);
    });
    panel.appendChild(tabBar);

    // Key grids (one per tab, hidden except active)
    _MATH_KEYS.forEach(group => {
      const grid = document.createElement("div");
      grid.className = "math-kb-grid";
      grid.dataset.grid = group.id;
      grid.style.display = group.id === this._tab ? "" : "none";

      group.keys.forEach(key => {
        const btn = document.createElement("button");
        btn.className = "math-kb-key";
        btn.textContent = key.l;
        if (key.t) btn.title = key.t;
        btn.dataset.insert = key.v;
        if (key.c) btn.dataset.cursor = key.c;
        grid.appendChild(btn);
      });
      panel.appendChild(grid);
    });

    document.body.appendChild(panel);
    this._panel = panel;
    this._built = true;

    // ── Events ───────────────────────────────────────────────

    // Tab switching
    tabBar.addEventListener("click", e => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      this._tab = btn.dataset.tab;
      tabBar.querySelectorAll(".math-kb-tab").forEach(b =>
        b.classList.toggle("math-kb-tab-active", b.dataset.tab === this._tab)
      );
      panel.querySelectorAll("[data-grid]").forEach(g =>
        (g.style.display = g.dataset.grid === this._tab ? "" : "none")
      );
    });

    // Key insertion
    panel.addEventListener("click", e => {
      const btn = e.target.closest("[data-insert]");
      if (!btn) return;
      e.preventDefault();
      this._insert(btn.dataset.insert, +(btn.dataset.cursor || 0));
    });

    // Backspace
    header.querySelector(".math-kb-bksp").addEventListener("click", e => {
      e.preventDefault();
      this._backspace();
    });

    // Close
    header.querySelector(".math-kb-close").addEventListener("click", () => this.detach());

    // Escape key closes
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && this._panel.style.display !== "none") this.detach();
    });

    // Click outside closes (but not clicks on kb-toggle buttons)
    document.addEventListener("pointerdown", e => {
      if (this._panel.style.display === "none") return;
      if (panel.contains(e.target)) return;
      if (e.target.closest(".math-kb-btn, .math-kb-btn-inline")) return;
      this.detach();
    }, true);
  }

  // ── Insert / backspace ────────────────────────────────────────

  _insert(text, cursorBack = 0) {
    const ta = this._target;
    if (!ta) return;
    const s    = ta.selectionStart;
    const e    = ta.selectionEnd;
    const val  = ta.value;
    ta.value   = val.slice(0, s) + text + val.slice(e);
    const pos  = s + text.length - cursorBack;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  _backspace() {
    const ta = this._target;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (s === e && s > 0) {
      ta.value = ta.value.slice(0, s - 1) + ta.value.slice(s);
      ta.setSelectionRange(s - 1, s - 1);
    } else if (s !== e) {
      ta.value = ta.value.slice(0, s) + ta.value.slice(e);
      ta.setSelectionRange(s, s);
    }
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

window.mathKb = new MathKeyboard();

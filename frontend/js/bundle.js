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
  startSession: (studentId, subtopic, { problemStatement = null, subSubtopicId = null } = {}) =>
    apiRequest("POST", "/tutor/sessions", {
      student_id: studentId,
      subtopic,
      problem_statement: problemStatement || null,
      sub_subtopic_id: subSubtopicId || null,
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
// Renders LaTeX math inside a given DOM element using KaTeX auto-render.
// Called after every dynamic content insertion (chat messages, quiz questions, etc.).
// Safe to call before the deferred KaTeX scripts have loaded — renderMathInElement
// will be undefined and we no-op gracefully.
function renderMath(el) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(el, {
    delimiters: [
      { left: "$$", right: "$$", display: true  },
      { left: "$",  right: "$",  display: false },
    ],
    throwOnError: false,
  });
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

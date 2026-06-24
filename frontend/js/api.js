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

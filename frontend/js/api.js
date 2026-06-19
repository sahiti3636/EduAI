// Tiny fetch wrapper for the EduAI backend API.
// Change API_BASE if the backend runs on a different host/port.
const API_BASE = window.EDUAI_API_BASE || "http://localhost:8001";

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
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

const Api = {
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
  logMetric: (studentId, subtopic, metricType, value) =>
    apiRequest("POST", "/metrics", { student_id: studentId, subtopic, metric_type: metricType, value }),
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

// ─────────────────────────────────────────────────────────────────────────────
// EduAI — frontend runtime config
// Points the frontend at the backend API. Loaded BEFORE bundle.js on every page.
//
// • Local dev / backend-served frontend:  leave this EMPTY ("") — same origin.
// • Vercel (frontend) + Render (backend):  set it to your Render service URL,
//   with NO trailing slash, e.g.:
//        window.EDUAI_API_BASE = "https://eduai-backend.onrender.com";
//
// This one value is used for all API calls AND the Study Pair WebSocket
// (which becomes wss://…). CORS on the backend already allows any origin.
// ─────────────────────────────────────────────────────────────────────────────
window.EDUAI_API_BASE = "";

// ── Study Pair Mode ───────────────────────────────────────────

function el(id) { return document.getElementById(id); }

// Compute WebSocket base URL from API_BASE
const WS_BASE = (() => {
  const b = window.EDUAI_API_BASE || "";
  if (b) return b.replace(/^http/, "ws");
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
})();

let ws = null;
let roomId = null;
let myRole = null; // 'host' | 'guest'

// ── Populate subtopic select ──────────────────────────────────
SUBTOPICS.forEach(s => {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.label;
  el("create-subtopic").appendChild(opt);
});

// ── Lobby: Create room ────────────────────────────────────────
el("create-room-btn").addEventListener("click", async () => {
  const subtopic = el("create-subtopic").value;
  if (!subtopic) { el("lobby-error").textContent = "Please choose a subject."; return; }
  if (!Store.studentId) { el("lobby-error").textContent = "Sign in first."; return; }
  el("lobby-error").textContent = "";
  el("create-room-btn").disabled = true;

  try {
    const room = await Api.createPairRoom(Store.studentId, subtopic);
    roomId = room.room_id;
    myRole = "host";
    showWaiting(room.room_id, room.problem_text, subtopic);
    connectWebSocket(room.room_id, room.problem_text, subtopic);
  } catch (e) {
    el("lobby-error").textContent = e.message;
    el("create-room-btn").disabled = false;
  }
});

// ── Lobby: Join room ──────────────────────────────────────────
el("join-room-btn").addEventListener("click", async () => {
  const code = el("join-code").value.trim().toUpperCase();
  if (code.length !== 6) { el("lobby-error").textContent = "Enter a 6-character room code."; return; }
  if (!Store.studentId) { el("lobby-error").textContent = "Sign in first."; return; }
  el("lobby-error").textContent = "";
  el("join-room-btn").disabled = true;

  try {
    const room = await Api.joinPairRoom(code, Store.studentId);
    roomId = room.id;
    myRole = "guest";
    connectWebSocket(room.id, room.problem_text, room.subtopic);
  } catch (e) {
    el("lobby-error").textContent = e.message;
    el("join-room-btn").disabled = false;
  }
});

el("join-code").addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase();
});

// ── Show waiting screen ───────────────────────────────────────
function showWaiting(code, problem, subtopic) {
  el("lobby-screen").style.display = "none";
  el("waiting-screen").style.display = "";
  el("display-room-code").textContent = code;
}

// ── WebSocket connection ──────────────────────────────────────
function connectWebSocket(rId, problemText, subtopic) {
  const url = `${WS_BASE}/ws/pair/${rId}/${Store.studentId}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("[pair] WS connected");
  });

  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data);
    handleServerMessage(msg, problemText, subtopic);
  });

  ws.addEventListener("close", () => {
    appendSystemMsg("Connection closed. Refresh to reconnect.");
  });

  ws.addEventListener("error", () => {
    appendSystemMsg("WebSocket error — check your connection.");
  });

  // Keep-alive ping every 25 s
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }, 25000);
}

// ── Handle incoming server messages ──────────────────────────
function handleServerMessage(msg, problemText, subtopic) {
  switch (msg.type) {
    case "history":
      showChatScreen(problemText, subtopic);
      msg.messages.forEach(m => appendMessage(m.role, m.label, m.content));
      scrollBottom();
      break;

    case "peer_join":
      updatePeerStatus(msg.role, true, msg.label);
      if (myRole === "host") {
        // Guest just joined — switch from waiting to chat
        showChatScreen(problemText, subtopic);
      }
      appendSystemMsg(`${msg.label} joined the session.`);
      break;

    case "peer_leave":
      updatePeerStatus(msg.role, false, msg.label);
      appendSystemMsg(`${msg.label} disconnected.`);
      break;

    case "student_message":
      // Only append messages from the other person (own messages are shown optimistically)
      if (msg.sender_id !== Store.studentId) {
        appendMessage(msg.role, msg.label, msg.content);
        scrollBottom();
      }
      break;

    case "tutor_typing":
      el("pair-typing").style.display = "flex";
      break;

    case "tutor_message":
      el("pair-typing").style.display = "none";
      appendMessage("tutor", "Tutor", msg.content);
      scrollBottom();
      break;

    case "pong":
      break;
  }
}

// ── Show chat screen ──────────────────────────────────────────
function showChatScreen(problemText, subtopic) {
  el("lobby-screen").style.display = "none";
  el("waiting-screen").style.display = "none";
  el("chat-screen").style.display = "flex";
  el("pair-status-bar").style.display = "";
  el("pair-room-badge").textContent = roomId;

  const subLabel = SUBTOPICS.find(s => s.id === subtopic)?.label || subtopic;
  el("pair-chat-title").textContent = `Study Pair — ${subLabel}`;

  el("pair-problem-text").innerHTML = safeMathHTML(problemText);
  if (typeof renderMath === "function") renderMath(el("pair-problem-text"));
}

// ── Append chat message ───────────────────────────────────────
function appendMessage(role, label, content) {
  const win = el("pair-chat-window");
  const wrap = document.createElement("div");

  const isMe = (role === myRole);
  const isTutor = role === "tutor";

  wrap.className = `chat-msg ${isTutor ? "msg-tutor" : isMe ? "msg-student" : "msg-peer"}`;

  const labelEl = document.createElement("div");
  labelEl.className = "pair-msg-label";
  labelEl.textContent = isMe ? "You" : label;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";

  let processed = content;
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

  processed = isTutor ? safeMathHTML(processed) : escapeHTML(processed);

  desmosMatches.forEach(match => {
    processed = processed.replace(`__DESMOS_${match.id}__`, `<div id="${match.id}" style="width:100%; height:300px; margin: 10px 0; border-radius: 8px; overflow: hidden; border: 1px solid var(--glass-border);"></div>`);
  });

  mermaidMatches.forEach(match => {
    processed = processed.replace(`__MERMAID_${match.id}__`, `<div id="${match.id}" class="mermaid" style="background: var(--surface-1); padding: 10px; border-radius: 8px; margin: 10px 0; overflow-x: auto; text-align: center;">${match.code}</div>`);
  });

  bubble.innerHTML = processed;

  wrap.appendChild(labelEl);
  wrap.appendChild(bubble);
  win.appendChild(wrap);

  if (isTutor && typeof renderMath === "function") renderMath(bubble);

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
}

function appendSystemMsg(text) {
  const win = el("pair-chat-window");
  const div = document.createElement("div");
  div.className = "chat-system-msg";
  div.textContent = text;
  win.appendChild(div);
  scrollBottom();
}

function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scrollBottom() {
  const win = el("pair-chat-window");
  win.scrollTop = win.scrollHeight;
}

// ── Peer status indicator ─────────────────────────────────────
function updatePeerStatus(role, online, label) {
  const peerRole = myRole === "host" ? "guest" : "host";
  if (role !== peerRole) return;
  const bar = el("peer-status");
  bar.textContent = online ? `${label} is here` : `${label} disconnected`;
  bar.className = `pair-peer-status ${online ? "peer-online" : "peer-offline"}`;
}

// ── Send message ──────────────────────────────────────────────
function sendMessage() {
  const input = el("pair-input");
  const content = input.value.trim();
  if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

  // Optimistic display
  appendMessage(myRole, "You", content);
  scrollBottom();

  ws.send(JSON.stringify({ type: "message", content }));
  input.value = "";
  input.style.height = "auto";
}

el("pair-send-btn").addEventListener("click", sendMessage);
el("pair-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

el("visualize-btn").addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const btn = el("visualize-btn");
  btn.disabled = true;

  appendMessage(myRole, "You", "Please show me a visual explanation of this step.");
  scrollBottom();

  ws.send(JSON.stringify({ type: "message", content: "[SYSTEM_VISUALIZE]" }));
  
  setTimeout(() => btn.disabled = false, 2000);
});

// ── Auto-join from URL ────────────────────────────────────────
function init() {
  if (!Store.studentId) {
    el("lobby-error").textContent = "Sign in on the home page first.";
    return;
  }

  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  if (code) {
    el("join-code").value = code.toUpperCase();
    el("join-room-btn").click();
  }
}

init();

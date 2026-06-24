// ── Auth gate ─────────────────────────────────────────────────
const overlay   = document.getElementById("teacher-auth-overlay");
const loginBtn  = document.getElementById("teacher-login-btn");
const authError = document.getElementById("teacher-auth-error");

function getToken() { return sessionStorage.getItem("eduai_teacher_token"); }

async function doTeacherLogin() {
  const username = document.getElementById("teacher-username").value.trim();
  const password = document.getElementById("teacher-password").value;
  authError.textContent = "";

  if (!username || !password) {
    authError.textContent = "Please enter username and password.";
    return;
  }
  try {
    const { token } = await Api.teacherLogin(username, password);
    sessionStorage.setItem("eduai_teacher_token", token);
    overlay.style.display = "none";
    load();
  } catch (e) {
    authError.textContent = e.message;
  }
}

loginBtn.addEventListener("click", doTeacherLogin);
document.getElementById("teacher-password").addEventListener("keydown", e => {
  if (e.key === "Enter") doTeacherLogin();
});

// ── Boot: check token ─────────────────────────────────────────
if (getToken()) {
  load();
} else {
  overlay.style.display = "flex";
}

// ── Load dashboard ────────────────────────────────────────────
async function load() {
  try {
    const [overview, feedback] = await Promise.all([
      Api.teacherOverview(),
      Api.teacherFeedback(),
    ]);
    render(overview, feedback);
    document.getElementById("teacher-loading").style.display = "none";
    document.getElementById("teacher-content").style.display = "";
  } catch (e) {
    // Token may have expired or server restarted — show login again
    if (e.message.includes("401")) {
      sessionStorage.removeItem("eduai_teacher_token");
      overlay.style.display = "flex";
      return;
    }
    document.getElementById("teacher-loading").style.display = "none";
    document.getElementById("teacher-error").textContent = "Could not load dashboard: " + e.message;
  }
}

function render(data, feedback) {
  const t = data.totals;

  // ── Top stats ──────────────────────────────────────────────
  const statsEl = document.getElementById("teacher-stats");
  const stats = [
    { icon: "👤", value: t.total_students,  label: "students"  },
    { icon: "📚", value: t.total_sessions,  label: "sessions"  },
    { icon: "✅", value: t.total_quizzes,   label: "quizzes"   },
    { icon: "🛡️", value: t.pressure_count,  label: "pressure attempts" },
    { icon: "⚠️", value: t.leak_count,      label: "possible leaks"    },
  ];
  statsEl.innerHTML = stats.map(s => `
    <div class="glass-card progress-stat-card">
      <span class="ps-icon">${s.icon}</span>
      <span class="ps-value" style="font-size:1.6rem">${s.value}</span>
      <span class="ps-label">${s.label}</span>
    </div>
  `).join("");

  // ── Guardrail health ───────────────────────────────────────
  const leakEl = document.getElementById("guardrail-leaks");
  if (data.possible_leaks.length === 0) {
    document.getElementById("guardrail-summary").innerHTML =
      `<span class="guardrail-ok">✓ No answer leaks detected</span>`;
  } else {
    document.getElementById("guardrail-summary").innerHTML =
      `<span class="guardrail-warn">${data.possible_leaks.length} possible leak(s) — review below</span>`;
    leakEl.innerHTML = data.possible_leaks.map(l => `
      <div class="teacher-leak-row">
        <span class="teacher-leak-session">Session ${l.session_id.slice(0,8)}…</span>
        <span class="teacher-leak-date">${l.created_at.slice(0,10)}</span>
        <p class="teacher-leak-msg">${escHtml(l.content)}</p>
      </div>
    `).join("");
  }

  // ── Bucket distribution ────────────────────────────────────
  const distEl = document.getElementById("bucket-dist");
  distEl.innerHTML = Object.entries(data.bucket_distribution).map(([subject, dist]) => {
    const total = (dist.A || 0) + (dist.B || 0) + (dist.C || 0);
    return `
      <div class="bucket-dist-row">
        <span class="bd-subject">${subject}</span>
        <div class="bd-bars">
          ${["A","B","C"].map(b => {
            const count = dist[b] || 0;
            const pct   = total ? Math.round(count/total*100) : 0;
            return `
              <div class="bd-bar-group">
                <div class="bd-bar">
                  <div class="bd-bar-fill bucket-${b}" style="height:${pct}%"></div>
                </div>
                <span class="bd-bar-label">Level ${b}</span>
                <span class="bd-bar-count">${count}</span>
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");

  // ── Student table ──────────────────────────────────────────
  const tbody = document.getElementById("student-tbody");
  tbody.innerHTML = data.students.map(s => {
    const bucketHtml = Object.entries(s.buckets)
      .map(([subj, b]) => `<span class="bucket-badge bucket-${b}" style="font-size:.65rem;padding:2px 8px">${subj}: ${b}</span>`)
      .join(" ") || '<span style="color:var(--text-lo);font-size:.75rem">—</span>';
    const avgHtml = s.avg_quiz_pct !== null
      ? `<span class="teacher-pct ${s.avg_quiz_pct>=80?'pct-hi':s.avg_quiz_pct>=50?'pct-mid':'pct-lo'}">${s.avg_quiz_pct}%</span>`
      : `<span style="color:var(--text-lo);font-size:.75rem">—</span>`;
    return `
      <tr>
        <td class="td-label">${escHtml(s.label)}</td>
        <td class="td-date">${s.joined}</td>
        <td class="td-buckets">${bucketHtml}</td>
        <td class="td-num">${s.quizzes_taken}</td>
        <td class="td-num">${avgHtml}</td>
      </tr>`;
  }).join("");

  // ── Written feedback ───────────────────────────────────────
  if (feedback && feedback.length > 0) {
    document.getElementById("feedback-section").style.display = "";
    document.getElementById("feedback-list").innerHTML = feedback.map(f => `
      <div class="teacher-feedback-item">
        <div class="teacher-feedback-meta">
          <span class="tf-student">${escHtml(f.student_id.slice(0,8))}…</span>
          <span class="tf-type">${f.metric_type.replace(/_/g," ")}</span>
          <span class="tf-date">${f.created_at.slice(0,10)}</span>
        </div>
        <p class="tf-body">${escHtml(f.text_feedback)}</p>
      </div>
    `).join("");
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

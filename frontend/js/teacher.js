// ── Auth gate ─────────────────────────────────────────────────
const overlay   = document.getElementById("teacher-auth-overlay");
const loginBtn  = document.getElementById("teacher-login-btn");
const authError = document.getElementById("teacher-auth-error");

function getToken() { return sessionStorage.getItem("mindforge_teacher_token"); }

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
    sessionStorage.setItem("mindforge_teacher_token", token);
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

// ── Tab navigation ────────────────────────────────────────────
document.querySelectorAll(".teacher-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".teacher-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".teacher-tab-panel").forEach(p => p.style.display = "none");
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).style.display = "";
  });
});

// ── Load dashboard ────────────────────────────────────────────
async function load() {
  try {
    const [overview, feedback] = await Promise.all([
      Api.teacherOverview(),
      Api.teacherFeedback(),
    ]);
    render(overview, feedback);
    document.getElementById("teacher-loading").style.display = "none";
    document.getElementById("tab-overview").style.display = "";
  } catch (e) {
    // Token may have expired or server restarted — show login again
    if (e.message.includes("401")) {
      sessionStorage.removeItem("mindforge_teacher_token");
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
    { icon: PVIcons.get("user", 20),   value: t.total_students,  label: "students"  },
    { icon: PVIcons.get("book", 20),   value: t.total_sessions,  label: "sessions"  },
    { icon: PVIcons.get("checkCircle", 20), value: t.total_quizzes, label: "quizzes" },
    { icon: PVIcons.get("shield", 20), value: t.pressure_count,  label: "pressure attempts" },
    { icon: PVIcons.get("alert", 20),  value: t.leak_count,      label: "possible leaks"    },
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

// ── Guardrail Audit tab ───────────────────────────────────────
document.getElementById("load-audit-btn").addEventListener("click", async () => {
  const btn  = document.getElementById("load-audit-btn");
  const load = document.getElementById("audit-loading");
  const out  = document.getElementById("audit-results");
  btn.disabled = true;
  load.style.display = "";
  out.innerHTML = "";
  try {
    const data = await Api.teacherGuardrailAudit();
    load.style.display = "none";
    if (data.total_flagged === 0) {
      out.innerHTML = '<p class="guardrail-ok" style="padding:12px 0;">✓ No answer leaks detected across all sessions.</p>';
      return;
    }
    out.innerHTML = `<p class="guardrail-warn" style="margin-bottom:12px;">${data.total_flagged} message(s) flagged — review below.</p>` +
      data.messages.map(m => `
        <div class="audit-leak-row glass-card">
          <div class="audit-leak-header">
            <span class="audit-student">${escHtml(m.student_label)}</span>
            <span class="audit-subtopic badge-pill" style="font-size:.65rem;">${m.subtopic}</span>
            <span class="audit-date">${m.date}</span>
          </div>
          <p class="audit-msg">${escHtml(m.content)}</p>
          <div class="audit-reasons">${m.reasons.map(r => `<span class="audit-reason-tag">${escHtml(r)}</span>`).join("")}</div>
        </div>
      `).join("");
  } catch (e) {
    load.style.display = "none";
    out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`;
    btn.disabled = false;
  }
});

// ── Rater Validation tab ──────────────────────────────────────
const SUBTOPIC_LABELS = { algebra: "Algebra", trigonometry: "Trigonometry", probability: "Probability" };

document.getElementById("load-validation-btn").addEventListener("click", async () => {
  const btn    = document.getElementById("load-validation-btn");
  const stats  = document.getElementById("validation-stats");
  const table  = document.getElementById("validation-table");
  btn.disabled = true;
  table.innerHTML = '<p style="color:var(--text-mid);font-size:.83rem;">Loading…</p>';
  try {
    const [students, valData] = await Promise.all([
      Api.teacherStudentsForValidation(),
      Api.teacherRaterValidation(),
    ]);

    // Agreement bar
    if (valData.total_assessed > 0) {
      const pct = valData.agreement_pct;
      const cls = pct >= 80 ? "pct-hi" : pct >= 60 ? "pct-mid" : "pct-lo";
      stats.innerHTML = `
        <div class="agreement-summary">
          <span class="agreement-label">Rater agreement</span>
          <span class="agreement-pct ${cls}">${pct}%</span>
          <span class="agreement-of">(${valData.total_assessed} assessed)</span>
        </div>
        <div class="agreement-progress">
          <div class="agreement-fill ${cls}" style="width:${pct}%"></div>
        </div>
      `;
      stats.style.display = "";
    }

    if (students.length === 0) {
      table.innerHTML = '<p style="color:var(--text-lo);font-size:.82rem;margin-top:12px;">No students have been bucketed yet.</p>';
      return;
    }

    // Build comparison map from valData
    const doneMap = {};
    (valData.comparisons || []).forEach(c => {
      doneMap[`${c.student_label}::${c.subtopic}`] = c;
    });

    table.innerHTML = `
      <table class="teacher-table validation-table" style="margin-top:8px;">
        <thead><tr>
          <th>Student</th><th>Subject</th><th>AI bucket</th><th>Your assessment</th><th>Match</th>
        </tr></thead>
        <tbody>
          ${students.map(s => {
            const key = `${s.student_label}::${s.subtopic}`;
            const done = doneMap[key];
            return `
              <tr data-sid="${escHtml(s.student_id)}" data-subtopic="${escHtml(s.subtopic)}">
                <td class="td-label">${escHtml(s.student_label)}</td>
                <td>${escHtml(SUBTOPIC_LABELS[s.subtopic] || s.subtopic)}</td>
                <td><span class="bucket-badge bucket-${s.ai_bucket}">${s.ai_bucket}</span></td>
                <td>
                  <div class="val-bucket-select">
                    ${["A","B","C"].map(b => `
                      <button class="val-bucket-btn ${done && done.teacher_bucket===b?'selected':''}"
                        data-b="${b}">${b}</button>`).join("")}
                    ${done ? `<button class="btn btn-ghost btn-xs val-submit-btn" disabled>✓ Saved</button>` :
                             `<button class="btn btn-primary btn-xs val-submit-btn" disabled>Save</button>`}
                  </div>
                </td>
                <td>${done ? (done.match ? '<span class="pct-hi">✓</span>' : '<span class="pct-lo">✗</span>') : '—'}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>`;

    // Wire up bucket selectors
    table.querySelectorAll("tr[data-sid]").forEach(row => {
      let chosen = null;
      const submitBtn = row.querySelector(".val-submit-btn");
      row.querySelectorAll(".val-bucket-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          row.querySelectorAll(".val-bucket-btn").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          chosen = btn.dataset.b;
          submitBtn.disabled = false;
          submitBtn.textContent = "Save";
        });
      });
      submitBtn.addEventListener("click", async () => {
        if (!chosen) return;
        submitBtn.disabled = true;
        submitBtn.textContent = "…";
        try {
          await Api.teacherSubmitBucketAssessment(row.dataset.sid, row.dataset.subtopic, chosen);
          submitBtn.textContent = "✓ Saved";
          // Refresh agreement stats
          const updated = await Api.teacherRaterValidation();
          if (updated.total_assessed > 0) {
            const pct2 = updated.agreement_pct;
            const cls2 = pct2 >= 80 ? "pct-hi" : pct2 >= 60 ? "pct-mid" : "pct-lo";
            stats.querySelector(".agreement-pct").textContent = pct2 + "%";
            stats.querySelector(".agreement-pct").className = `agreement-pct ${cls2}`;
            stats.querySelector(".agreement-fill").style.width = pct2 + "%";
            stats.querySelector(".agreement-fill").className = `agreement-fill ${cls2}`;
            stats.querySelector(".agreement-of").textContent = `(${updated.total_assessed} assessed)`;
            stats.style.display = "";
          }
        } catch (e) {
          submitBtn.textContent = "Error";
          submitBtn.disabled = false;
        }
      });
    });
  } catch (e) {
    table.innerHTML = `<p class="error">${escHtml(e.message)}</p>`;
    btn.disabled = false;
  }
});

// ── Session Feedback tab ──────────────────────────────────────
document.getElementById("load-sfeedback-btn").addEventListener("click", async () => {
  const btn = document.getElementById("load-sfeedback-btn");
  const out = document.getElementById("sfeedback-results");
  btn.disabled = true;
  out.innerHTML = '<p style="color:var(--text-mid);font-size:.83rem;">Loading…</p>';
  try {
    // Fetch feedback for all students via overview students list
    const overview = await Api.teacherOverview();
    const studentIds = (overview.students || []).map(s => s.id);
    const summaries = await Promise.all(
      studentIds.map(id => Api.getFeedbackSummary(id).catch(() => null))
    );
    const valid = summaries.filter(s => s && s.total > 0);
    if (valid.length === 0) {
      out.innerHTML = '<p style="color:var(--text-lo);font-size:.82rem;">No session feedback submitted yet.</p>';
      return;
    }
    const totalSessions = valid.reduce((s, x) => s + x.total, 0);
    const allScores = valid.flatMap(x => x.recent.filter(r => r.frustration_score).map(r => r.frustration_score));
    const avgFrust = allScores.length ? (allScores.reduce((a,b)=>a+b,0)/allScores.length).toFixed(1) : "—";
    const dist = valid.reduce((acc, x) => {
      Object.entries(x.guidance_distribution).forEach(([k,v]) => { acc[k] = (acc[k]||0)+v; });
      return acc;
    }, {too_much:0,just_right:0,too_little:0});

    const total = dist.too_much + dist.just_right + dist.too_little || 1;
    out.innerHTML = `
      <div class="sfeedback-summary glass-card">
        <div class="sfb-stat"><span class="sfb-val">${totalSessions}</span><span class="sfb-lbl">responses</span></div>
        <div class="sfb-stat"><span class="sfb-val">${avgFrust}</span><span class="sfb-lbl">avg frustration / 5</span></div>
        <div class="sfb-stat"><span class="sfb-val">${Math.round(dist.just_right/total*100)}%</span><span class="sfb-lbl">felt "just right"</span></div>
      </div>
      <div class="sfeedback-dist glass-card" style="margin-top:12px;">
        <p style="font-size:.78rem;color:var(--text-mid);margin-bottom:10px;">Guidance distribution across all sessions</p>
        ${[["too_little","Too little","var(--amber)"],["just_right","Just right","var(--green)"],["too_much","Too much","var(--crimson)"]].map(([k,lbl,color]) => {
          const pct = Math.round((dist[k]||0)/total*100);
          return `<div class="sfb-dist-row">
            <span class="sfb-dist-lbl">${lbl}</span>
            <div class="sfb-dist-bar-wrap"><div class="sfb-dist-bar" style="width:${pct}%;background:${color}"></div></div>
            <span class="sfb-dist-n">${dist[k]||0}</span>
          </div>`;
        }).join("")}
      </div>`;
  } catch (e) {
    out.innerHTML = `<p class="error">${escHtml(e.message)}</p>`;
    btn.disabled = false;
  }
});

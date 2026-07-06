// ── Progress Report Page ──────────────────────────────────────

const BUCKET_LABEL = { A: "Level A — Strong", B: "Level B — Developing", C: "Level C — Foundational" };
const BUCKET_CLASS = { A: "bucket-A", B: "bucket-B", C: "bucket-C" };

function el(id) { return document.getElementById(id); }

function renderBuckets(buckets) {
  const container = el("rpt-buckets");
  if (!buckets || buckets.length === 0) {
    container.innerHTML = '<p style="color:var(--text-lo);font-size:.82rem;">No diagnostic taken yet.</p>';
    return;
  }
  container.innerHTML = buckets.map(b => `
    <div class="rpt-bucket-card glass-card">
      <div class="rpt-bucket-name">${b.label}</div>
      <span class="bucket-badge ${BUCKET_CLASS[b.bucket] || ''}">${b.bucket}</span>
      <div class="rpt-bucket-date">assessed ${b.updated_at}</div>
    </div>
  `).join("");
}

function renderNotes(notes) {
  const section = el("rpt-notes-section");
  const container = el("rpt-notes");
  if (!notes || notes.length === 0) {
    section.style.display = "none";
    return;
  }
  container.innerHTML = notes.map(n => `
    <div class="glass-card rpt-note-card">
      <div class="rpt-note-meta">
        <span class="rpt-note-sub">${n.subtopic}</span>
        <span class="rpt-note-date">${n.date}</span>
      </div>
      <p class="rpt-note-text">${n.breakthrough}</p>
      ${n.struggled_with ? `<p class="rpt-note-struggled">Struggled with: ${n.struggled_with}</p>` : ""}
    </div>
  `).join("");
}

function renderMastery(summary) {
  const section = el("rpt-mastery-section");
  const container = el("rpt-mastery");
  if (!summary || summary.length === 0) {
    section.style.display = "none";
    return;
  }
  container.innerHTML = summary.map(s => {
    const total = (s.solid || 0) + (s.shaky || 0) + (s.not_tested || 0);
    const solidPct  = total ? Math.round((s.solid || 0) / total * 100) : 0;
    const shakyPct  = total ? Math.round((s.shaky || 0) / total * 100) : 0;
    return `
      <div class="rpt-mastery-row">
        <span class="rpt-mastery-label">${s.label}</span>
        <div class="rpt-mastery-bar-wrap">
          <div class="rpt-mastery-bar">
            <div class="rpt-bar-solid" style="width:${solidPct}%"></div>
            <div class="rpt-bar-shaky" style="width:${shakyPct}%"></div>
          </div>
          <span class="rpt-mastery-counts">
            <span class="rpt-count-solid">${s.solid || 0} solid</span>
            <span class="rpt-count-shaky">${s.shaky || 0} shaky</span>
            <span class="rpt-count-nt">${s.not_tested || 0} not tested</span>
          </span>
        </div>
      </div>`;
  }).join("");
}

function renderErrors(patterns) {
  const section = el("rpt-errors-section");
  const container = el("rpt-errors");
  if (!patterns || patterns.length === 0) {
    section.style.display = "none";
    return;
  }
  const max = Math.max(...patterns.map(p => p.count));
  container.innerHTML = patterns.map(p => {
    const pct = Math.round(p.count / max * 100);
    return `
      <div class="rpt-error-row">
        <div class="rpt-error-info">
          <span class="rpt-error-type">${p.error_type}</span>
          <span class="rpt-error-sub">${p.label}</span>
        </div>
        <div class="rpt-error-bar-wrap">
          <div class="rpt-error-bar" style="width:${pct}%"></div>
          <span class="rpt-error-count">${p.count}×</span>
        </div>
      </div>`;
  }).join("");
}

function renderQuizzes(quizzes) {
  const section = el("rpt-quiz-section");
  const container = el("rpt-quizzes");
  if (!quizzes || quizzes.length === 0) {
    section.style.display = "none";
    return;
  }
  container.innerHTML = quizzes.map(q => {
    const cls = q.pct >= 80 ? "quiz-good" : q.pct >= 50 ? "quiz-ok" : "quiz-bad";
    return `
      <div class="rpt-quiz-row">
        <div class="rpt-quiz-info">
          <span class="rpt-quiz-chapter">${q.chapter}</span>
          <span class="rpt-quiz-date">${q.date}</span>
        </div>
        <span class="rpt-quiz-score ${cls}">${q.score}/${q.total} (${q.pct}%)</span>
      </div>`;
  }).join("");
}

function renderDueReviews(due) {
  const section = el("rpt-due-section");
  if (!due || due.length === 0) return;
  el("rpt-due-list").innerHTML = due.map(r =>
    `<a href="chat.html?subtopic=${r.subtopic}" class="due-chip">${r.label} →</a>`
  ).join(" ");
  section.style.display = "flex";
}

function renderAchievements(achievements) {
  const section = el("rpt-achievements-section");
  const container = el("rpt-achievements");
  if (!achievements || achievements.length === 0) {
    section.style.display = "none";
    return;
  }
  container.innerHTML = achievements.map(a => `
    <div class="rpt-achievement-card ${a.earned ? 'earned' : 'locked'}">
      <div class="rpt-ach-icon">${a.icon}</div>
      <div class="rpt-ach-info">
        <div class="rpt-ach-title">${a.title}</div>
        <div class="rpt-ach-desc">${a.desc}</div>
        ${a.earned && a.unlocked_at ? `<div class="rpt-ach-date">${a.unlocked_at.slice(0,10)}</div>` : ""}
      </div>
      ${!a.earned ? '<div class="rpt-ach-lock">🔒</div>' : '<div class="rpt-ach-check">✓</div>'}
    </div>
  `).join("");
}

async function loadReport() {
  if (!Store.studentId) {
    el("report-loading").innerHTML =
      '<p style="color:var(--text-mid);">Please <a href="index.html" style="color:var(--cyan);">sign in</a> first.</p>';
    return;
  }

  const headerLbl = el("header-label");
  if (headerLbl) headerLbl.textContent = Store.studentLabel || "";

  try {
    const [data, achievements] = await Promise.all([
      Api.getReport(Store.studentId),
      Api.getAchievements(Store.studentId).catch(() => []),
    ]);

    el("report-loading").style.display = "none";
    el("report-content").style.display = "block";
    el("report-date").textContent = "Generated " + data.generated_at;

    el("stat-streak").textContent   = data.streak_days;
    el("stat-sessions").textContent = data.total_sessions;
    el("stat-quizzes").textContent  = data.total_quizzes;

    renderDueReviews(data.due_reviews);
    renderBuckets(data.buckets);
    renderNotes(data.recent_notes);
    renderMastery(data.mastery_summary);
    renderErrors(data.error_patterns);
    renderQuizzes(data.recent_quizzes);
    renderAchievements(achievements);
  } catch (e) {
    el("report-loading").textContent = "Could not load report.";
    console.error(e);
  }
}

loadReport();

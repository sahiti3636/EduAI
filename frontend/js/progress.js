if (!Store.studentId) window.location.href = "index.html";

document.getElementById("student-label-badge").textContent = Store.studentLabel || "Student";

const BUCKET_LABEL = { A: "Level A — Strong", B: "Level B — Developing", C: "Level C — Foundational" };

async function load() {
  try {
    const [data, dueDeckData, errorData] = await Promise.all([
      Api.getProgress(Store.studentId),
      Api.getDueFlashcards(Store.studentId).catch(() => []),
      Api.getErrorPatterns(Store.studentId).catch(() => null),
    ]);
    render(data, dueDeckData, errorData);
    document.getElementById("progress-loading").style.display = "none";
    document.getElementById("progress-content").style.display = "";
  } catch (e) {
    document.getElementById("progress-loading").style.display = "none";
    document.getElementById("progress-error").textContent = "Could not load progress: " + e.message;
  }
}

function render(data, dueDecks, errorData) {
  // ── Flashcard review banner ────────────────────────────────
  const totalDueCards = (dueDecks || []).reduce((n, d) => n + d.cards.length, 0);
  if (totalDueCards > 0) {
    const banner = document.createElement("a");
    banner.href = "review.html";
    banner.className = "review-banner";
    banner.innerHTML = `
      <span class="review-banner-icon">🃏</span>
      <span class="review-banner-text">
        <strong>${totalDueCards} flashcard${totalDueCards !== 1 ? "s" : ""}</strong> due for review today
      </span>
      <span class="review-banner-cta">Review now →</span>
    `;
    document.getElementById("progress-content").prepend(banner);
  }

  // ── Error pattern card ────────────────────────────────────
  if (errorData?.has_data && errorData.patterns.length > 0) {
    const card = document.createElement("div");
    card.className = "glass-card error-pattern-card";
    card.innerHTML = `
      <h3 class="error-pattern-title">📉 Recurring patterns to work on</h3>
      <p class="error-pattern-sub">Based on ${errorData.total_questions_attempted} questions answered · Overall accuracy: ${errorData.overall_accuracy}%</p>
      <div class="error-pattern-list">
        ${errorData.patterns.map(p => `
          <div class="ep-item ep-${p.severity}">
            <div class="ep-chapter">${p.chapter}</div>
            <div class="ep-bar-wrap">
              <div class="ep-bar"><div class="ep-bar-fill" style="width:${p.pct_wrong}%"></div></div>
              <span class="ep-stat">${p.wrong}/${p.total} wrong</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    document.getElementById("progress-content").appendChild(card);
  }

  // ── Stats row ─────────────────────────────────────────────
  const statsRow = document.getElementById("progress-stats-row");
  const stats = [
    { icon: "🔥", value: data.streak_days, label: "day streak" },
    { icon: "📚", value: data.total_sessions, label: "sessions" },
    { icon: "✅", value: data.total_quizzes, label: "quizzes taken" },
  ];
  statsRow.innerHTML = stats.map(s => `
    <div class="glass-card progress-stat-card">
      <span class="ps-icon">${s.icon}</span>
      <span class="ps-value">${s.value}</span>
      <span class="ps-label">${s.label}</span>
    </div>
  `).join("");

  // ── Per-subject sections ───────────────────────────────────
  const subjectsEl = document.getElementById("progress-subjects");
  subjectsEl.innerHTML = "";

  data.subtopics.forEach(st => {
    const section = document.createElement("div");
    section.className = "progress-subject-section";

    const bucketHtml = st.bucket
      ? `<span class="bucket-badge bucket-${st.bucket}">${BUCKET_LABEL[st.bucket] || st.bucket}</span>`
      : `<span class="bucket-badge" style="background:var(--glass-bg);color:var(--text-lo);">Not assessed yet</span>`;

    const completedCount = st.chapters.filter(c => c.completed).length;

    section.innerHTML = `
      <div class="progress-subject-header">
        <div>
          <h2 class="progress-subject-title">${st.label}</h2>
          <p class="progress-subject-meta">${completedCount} / ${st.chapters.length} chapters quizzed · ${st.sessions_count} sessions</p>
        </div>
        ${bucketHtml}
      </div>
      <div class="progress-chapters-grid" id="chapters-${st.id}"></div>
    `;
    subjectsEl.appendChild(section);

    const chaptersEl = document.getElementById(`chapters-${st.id}`);
    st.chapters.forEach(ch => {
      const card = document.createElement("div");
      card.className = "glass-card progress-chapter-card" + (ch.completed ? " ch-done" : "");

      const bestHtml = ch.best_pct !== null
        ? `<div class="ch-score-bar"><div class="ch-score-fill" style="width:${ch.best_pct}%"></div></div>
           <span class="ch-score-text">${ch.best_pct}% best</span>`
        : `<span class="ch-not-done">Quiz not taken</span>`;

      const attemptsHtml = ch.quiz_attempts.length > 1
        ? `<div class="ch-attempts">${ch.quiz_attempts.map((a, i) =>
            `<span class="ch-attempt-dot" title="Attempt ${i+1}: ${a.score}/${a.total} on ${a.date}"
              style="background:${a.pct>=80?'rgba(34,197,94,.7)':a.pct>=50?'rgba(234,179,8,.7)':'rgba(239,68,68,.7)'}"></span>`
          ).join("")}</div>`
        : "";

      card.innerHTML = `
        <div class="ch-name">${ch.label}</div>
        ${bestHtml}
        ${attemptsHtml}
        <div class="ch-actions">
          <a href="chat.html?subtopic=${st.id}" class="btn btn-ghost btn-xs ch-action-btn">Study →</a>
          ${ch.completed ? `<a href="quiz.html" class="btn btn-ghost btn-xs ch-action-btn" onclick="storeQuizCtx('${st.id}','${ch.id}','${ch.label}')">Retake quiz</a>` : ""}
        </div>
      `;
      chaptersEl.appendChild(card);
    });
  });
}

function storeQuizCtx(subtopic, chapterId, chapterLabel) {
  sessionStorage.setItem("eduai_quiz_subtopic", subtopic);
  sessionStorage.setItem("eduai_quiz_chapter_id", chapterId);
  sessionStorage.setItem("eduai_quiz_chapter_label", chapterLabel);
}

load();

// ── Leaderboard Page ──────────────────────────────────────────

function el(id) { return document.getElementById(id); }

const MEDAL = ["🥇", "🥈", "🥉"];

async function loadLeaderboard() {
  if (!Store.studentId) {
    el("lb-loading").textContent = "Sign in on the home page first.";
    return;
  }

  const headerLbl = el("header-label");
  if (headerLbl) headerLbl.textContent = Store.studentLabel || "";

  // Load opt-in status and render toggle
  try {
    const { opted_in } = await Api.getLeaderboardStatus(Store.studentId);
    el("lb-opt-toggle").checked = opted_in;
  } catch (_) {}

  el("lb-opt-toggle").addEventListener("change", async (e) => {
    try {
      await Api.setLeaderboardOpt(Store.studentId, e.target.checked);
      await renderBoard();
    } catch (err) {
      console.error(err);
    }
  });

  await renderBoard();
}

async function renderBoard() {
  el("lb-loading").style.display = "block";
  el("lb-board").style.display = "none";
  el("lb-empty").style.display = "none";
  el("own-rank-card").style.display = "none";

  try {
    const data = await Api.getLeaderboard(Store.studentId);

    el("lb-loading").style.display = "none";

    // Own rank
    if (data.own) {
      el("own-rank").textContent = `#${data.own.rank}`;
      el("own-score").textContent = `${data.own.score} pts`;
      el("own-rank-card").style.display = "";
    }

    if (!data.board || data.board.length === 0) {
      el("lb-empty").style.display = "block";
      return;
    }

    el("lb-board").style.display = "block";
    el("lb-board").innerHTML = data.board.map((entry, i) => {
      const medal = i < 3 ? `<span class="lb-medal">${MEDAL[i]}</span>` : `<span class="lb-rank">#${entry.rank}</span>`;
      const isMe = data.own && entry.rank === data.own.rank && data.own.opted_in !== false;
      return `
        <div class="lb-row glass-card ${isMe ? "lb-row-me" : ""}">
          ${medal}
          <span class="lb-name">${entry.label}${isMe ? " (you)" : ""}</span>
          <span class="lb-score">${entry.score} pts</span>
        </div>`;
    }).join("");
  } catch (e) {
    el("lb-loading").textContent = "Could not load leaderboard.";
    console.error(e);
  }
}

loadLeaderboard();

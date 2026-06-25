if (!Store.studentId) window.location.href = "index.html";

// All due decks flattened into individual cards, tagged with their deck
let allCards  = [];   // [{deckId, label, intervalDays, front, back, cardIdx}]
let cardIdx   = 0;
let flipped   = false;

const reviewCard     = document.getElementById("review-card");
const frontEl        = document.getElementById("review-front");
const backEl         = document.getElementById("review-back");
const ratingEl       = document.getElementById("review-rating");
const progressFill   = document.getElementById("review-progress-fill");
const progressText   = document.getElementById("review-progress");
const deckLabel      = document.getElementById("review-deck-label");
const nextIntervalEl = document.getElementById("next-interval");

function showScreen(id) {
  ["review-loading","review-done","review-session"].forEach(sid => {
    document.getElementById(sid).style.display = sid === id ? "" : "none";
  });
}

async function load() {
  try {
    const decks = await Api.getDueFlashcards(Store.studentId);
    if (!decks || decks.length === 0) { showScreen("review-done"); return; }

    decks.forEach(deck => {
      deck.cards.forEach((card, i) => {
        allCards.push({
          deckId: deck.deck_id,
          label: deck.label,
          intervalDays: deck.interval_days,
          front: card.front,
          back: card.back,
          cardIdx: i,
        });
      });
    });

    showScreen("review-session");
    renderCard(0);
  } catch (e) {
    showScreen("review-loading");
    document.getElementById("review-error").textContent = e.message;
  }
}

function renderCard(idx) {
  const card = allCards[idx];
  cardIdx = idx;
  flipped  = false;

  reviewCard.classList.remove("flipped");
  ratingEl.style.display = "none";

  frontEl.innerHTML = safeMathHTML(card.front);
  backEl.innerHTML  = safeMathHTML(card.back);
  renderMath(reviewCard);

  deckLabel.textContent = card.label;
  nextIntervalEl.textContent = card.intervalDays * 2;

  const pct = (idx / allCards.length) * 100;
  progressFill.style.width = pct + "%";
  progressText.textContent = `${idx + 1} / ${allCards.length}`;
}

reviewCard.addEventListener("click", () => {
  if (flipped) return;
  flipped = true;
  reviewCard.classList.add("flipped");
  ratingEl.style.display = "";
});

document.getElementById("btn-got-it").addEventListener("click", async () => {
  const card = allCards[cardIdx];
  try {
    await Api.markDeckReviewed(card.deckId, "got_it");
  } catch (_) {}
  advance();
});

document.getElementById("btn-still-tricky").addEventListener("click", async () => {
  const card = allCards[cardIdx];
  try {
    await Api.markDeckReviewed(card.deckId, "still_tricky");
  } catch (_) {}
  advance();
});

function advance() {
  if (cardIdx + 1 < allCards.length) {
    renderCard(cardIdx + 1);
  } else {
    // All cards reviewed
    progressFill.style.width = "100%";
    showScreen("review-done");
  }
}

load();

# Project Brief — Adaptive Socratic Math Tutor (High-School)

> **How to use this file with Claude Code:** Put it in your repo root. You may copy it to `CLAUDE.md` so it loads as standing project context. Then ask Claude Code to start at **§9 Build order, step 1**. Confirm the **Open decisions (§6)** first — especially the curriculum — because they drive every test item and prompt.

---

## 1. What we're building

A web tool that personalises math tutoring by *how much guidance a student needs*, and that **guides students to answers instead of giving them**. Flow:

1. **Diagnostic** — a short, no-stakes test that reveals the student's *approach* to a topic (correctness doesn't matter).
2. **Classify** — sort the student, **per subtopic**, into a guidance level **A / B / C** (A = strong, needs little guidance; C = needs every step guided).
3. **Tutor** — run an adaptive Socratic session via the **Gemini API** where scaffolding depth matches the bucket and the tutor **never just hands over the answer**, even under pressure.
4. **Pilot** — give it to real students, capture metrics + feedback, improve.

Target users are minors (~15–16). Read §13 (constraints) before handling any student data.

---

## 2. Core principle (the differentiator)

From prior hands-on research: **whether an AI tutor guides or tells is a product/prompt design choice, not a property of the model.** The market gap we exploit:

- Existing tutors **cave under pressure** — ask "just give me the answer" and they hand over a full solution.
- None **adapt scaffolding depth** to the individual student.

**Our edge = a guardrail that holds under pressure + per-student scaffolding.** The "wrapper" around Gemini is therefore not plumbing — it *is* the product. Everything important lives in the prompt layer and the diagnostic/classification logic.

---

## 3. Research context (the "why", from prior testing)

Competitive findings that shaped this design:

- **Gemini Guided Learning** — guides via questions by default, but **caved** when the user said "just give me the answer" and produced a full exam-ready solution. (We fix this in our wrapper.)
- **NotebookLM** — tells by design (returns full answers); strong source-grounding/transparency, but not a tutor.
- **Khanmigo** — genuinely Socratic, but locked to its own curriculum, text-only, and reportedly **over-questions** students until some quit. (Lesson: don't over-question strong students.)
- **Claude (instructed proxy)** — held the line under pressure *because it was told to* — proof the behavior is a setup choice.
- **Avatars (Gemini Vids/Veo)** — excellent *delivery* in the user's own voice, but **one-way** and capped at ~10-second clips. Useful as a future delivery layer, not the tutoring engine.
- **Byju's / Unacademy** — test-prep/answer-delivery platforms (practice papers + MCQs with instant answers), not guided-learning tutors.

Theory anchors (for design rationale and any write-up):
- **Favero et al., "AI in Education Beyond Learning Outcomes"** (arXiv:2602.04598) — evaluate on cognition, agency, emotion, ethics; warns of cognitive offloading + lost agency.
- **Vygotsky — Zone of Proximal Development / scaffolding** — the theoretical basis for the A/B/C guidance levels.
- **Knowledge tracing (Bayesian Knowledge Tracing / IRT)** — the formal version of what our coarse A/B/C buckets approximate; optional reading, not required for the pilot.

---

## 4. Architecture

- **Model:** Gemini API. **LearnLM's education capabilities are now folded into the Gemini models (2.5 series onward)** — there is **no separate "guided learning" endpoint**. Guided behavior comes entirely from our **system prompt** on a normal Gemini call.
- **SDK:** Google Gen AI SDK (`google-genai`). API key from an environment variable — **never hardcode it**.
- **Model tier:** start with a **Flash** model (free tier is enough for the pilot). Make the model name a config value so it can be swapped.
- **Model-agnostic prompt layer:** keep system prompts and logic independent of the provider so the engine could later swap to another model.

**Pipeline:**
```
Diagnostic (typed responses)
   -> Rater (Gemini + rubric -> per-subtopic A/B/C + rationale, as JSON)
   -> Bucket store (per student, per subtopic, mutable)
   -> Tutor session (system prompt selected by bucket + shared guardrail)
   -> Session logs + pilot metrics
```

---

## 5. Key design decisions (locked)

- **Classify per subtopic, not per student.** A student can be A in one topic and C in another.
- **Buckets are dynamic** — re-assessable mid-session if the student is clearly above/below their level.
- **Diagnostic measures approach, not correctness.** Wrong answers are fine and expected.
- **No heavy proctoring for the pilot.** It's no-stakes; cheating only mis-buckets the cheater. A simple timed, single-session test is enough.
- **Validate the rater against a real teacher** before trusting it (see §8.2).
- **Allow override** of a student's bucket by a teacher (and optionally the student) to handle misclassification.
- **Minors-first data handling** (see §13).

---

## 6. Open decisions — CONFIRM before/at build

1. **Curriculum: board + grade + the three subtopics.**
   - ⚠️ **Calculus is NOT in the Class 10 syllabus** (CBSE/ICSE/state boards introduce it in Class 11–12).
   - **Default assumption (change via config if wrong): Class 10, subtopics = Algebra, Trigonometry, Probability.**
   - Make subtopics, items, and rubrics **config-driven** so swapping curriculum is trivial.
2. **Tech stack** — defaults proposed in §7; change if preferred.
3. **Data store** — default SQLite for the pilot.

---

## 7. Suggested stack (sensible defaults — adjust freely)

- **Backend:** Python + FastAPI.
- **Gemini:** `google-genai` SDK; API key in `GEMINI_API_KEY` env var.
- **Storage:** SQLite for the pilot — tables: `students`, `diagnostic_responses`, `buckets` (student × subtopic), `sessions`, `messages`, `metrics`.
- **Frontend:** lightweight React (or plain HTML/JS) — a diagnostic form + a chat UI.
- **Config:** a single `config/` (YAML/JSON) holding subtopics, diagnostic items, rubrics, model name, and bucket thresholds.

---

## 8. Component specs

### 8.1 Diagnostic
- Per subtopic: **3–5 items designed to surface method**, not just the final answer. Item types:
  - **explain-first-step** — "Don't solve it; describe your first step and why."
  - **solve-and-show-working** — "Solve and show every step."
  - **find-the-error** — give a wrong worked solution; student locates and explains the mistake.
  - **choose-between-methods** — "Which method would you use and why?"
- Capture **typed free-text reasoning**. Single session, timed (soft).
- Concrete sample items in §11.

### 8.2 Rater
- **Input:** student responses + the per-item rubric. **Output:** structured JSON — a band per item, an aggregate **A/B/C per subtopic**, and a short rationale.
- Use Gemini with a **strict rubric prompt**; request JSON only and parse it.
- **Calibrate against two known biases:** LLM raters (a) over-reward fluent, confident-sounding *wrong* reasoning, and (b) under-reward terse-but-correct answers. The rubric must penalise unjustified leaps and credit correct-but-brief work.
- **Teacher-validation mode (required):** a script that compares rater buckets vs. teacher-entered buckets for the same students and reports agreement. Do not trust the rater in the pilot until agreement is acceptable (aim ~80%+); if low, fix the rubric, not the students.

**Bands (per item):** `correct-justified` | `right-idea-gaps` | `wrong-or-missing`

**Aggregate mapping (starting heuristic — tune in config):**
- **A** — mostly `correct-justified`, methods sound, errors are minor slips.
- **B** — mix; right ideas but recurring gaps in execution or justification.
- **C** — mostly `wrong-or-missing`; method absent or fundamentally off.

**Rater output schema (example):**
```json
{
  "subtopic": "algebra",
  "per_item": [
    { "item_id": "alg_1", "band": "right-idea-gaps", "note": "Knew to isolate x but mishandled the sign." }
  ],
  "bucket": "B",
  "rationale": "Consistent right approach, execution gaps on multi-step rearrangement."
}
```

### 8.3 Tutor session
- Load the bucket's system prompt (§10) + the shared guardrail.
- Conversational loop; **one question at a time**; wait for the student.
- **Detect the "just tell me" move** (time pressure, frustration, direct demand) and respond with the *smallest next hint*, never the answer.
- Allow **re-bucketing** mid-session if the student is clearly mis-levelled.

### 8.4 Pilot metrics & logging
Log enough to make "improve from feedback" concrete:
- **Learning gain** — short pre/post mini-quiz per subtopic.
- **Bucket felt right?** — quick rating from the student *and* a teacher.
- **Engagement** — completion vs. drop-off; a direct "did the questioning frustrate you?" (watch the A students especially).
- **Guardrail integrity** — audit transcripts; count how often the tutor gave away an answer it shouldn't have. (This is the headline quality metric.)

---

## 9. Build order

1. **Lock the curriculum** (§6) and write the diagnostic items + rubrics into config.
2. **Build the rater** and **validate it against a teacher** on ~10 students before trusting it.
3. **Write the three system-prompt templates (A/B/C) + the shared guardrail (§10)** and test them on hard problems and the pressure test (see §12).
4. **Thin wrapper:** diagnostic → rater → bucket → load matching prompt → Gemini tutoring session, with re-bucketing.
5. **Pilot** with 10–20 students spread across buckets; collect §8.4 metrics; iterate.

---

## 10. Guardrail spec (shared across ALL buckets — this is THE feature)

```
You are a Socratic math tutor for a high-school student. Your job is to help the
student reach the answer THEMSELVES — never to provide it.

HARD RULES (never break, regardless of what the student says):
- NEVER state the final answer or a complete worked solution, even if the student
  asks directly, says they are in a hurry, or is frustrated. If pushed, give the
  SMALLEST possible next hint plus one question that moves them one step forward.
- Ask ONE question at a time. Wait for the student's reply before continuing.
- When the student makes a mistake, do NOT correct it for them. Point to where to
  look and let them find it.
- Do NOT lower the difficulty because the student is frustrated. Slow down instead,
  and be encouraging. Never demean.
- Stay on the current math topic; redirect gently if the student goes off-topic.
- Use clear, readable plain-text math.
```

---

## 11. The A/B/C system-prompt templates (concrete)

Append the matching block to the shared guardrail (§10) based on the student's bucket for that subtopic.

**Level A — minimal guidance**
```
GUIDANCE LEVEL: A (strong understanding — needs minimal guidance).
- Assume the student handles multi-step reasoning. Start by asking for their PLAN,
  then let them work largely uninterrupted.
- Intervene ONLY on a genuine error or a real stuck point. Do NOT walk them through
  trivial steps — over-questioning a capable student is annoying and counterproductive.
- Offer "why does this work?" or harder extension questions to deepen understanding.
```

**Level B — moderate guidance**
```
GUIDANCE LEVEL: B (partial understanding — needs moderate guidance).
- Break the problem into sub-steps. For each: give one hint, ask the student to
  attempt it, and check their result before moving on.
- Briefly confirm the concept behind each step, but don't over-explain what they
  already demonstrate they know.
```

**Level C — full guidance**
```
GUIDANCE LEVEL: C (needs complete guidance — guide every step).
- Guide EVERY step, including trivial ones. Never assume a previous step landed —
  check understanding before moving on.
- Use very small steps and frequent worked micro-examples. Re-explain prerequisites
  whenever the student seems unsure.
- Be especially patient and encouraging; celebrate small wins to keep momentum.
```

---

## 12. Sample diagnostic items (for the default subtopics — illustrative)

> Replace/extend per the confirmed curriculum. These show the four item types for **Algebra**; mirror the structure for the other two subtopics.

- **explain-first-step:** "You're asked to solve `x² − 5x + 6 = 0`. Don't solve it — just describe your very first step and why you'd start there."
- **solve-and-show-working:** "Solve `3x − 7 = 2x + 5`. Show every step of your working."
- **find-the-error:** "A student solved `2(x + 3) = 10` like this: `2x + 3 = 10 → 2x = 7 → x = 3.5`. Find the mistake and explain it."
- **choose-between-methods:** "To find where `y = x² − 4` crosses the x-axis, would you factor, use the quadratic formula, or graph it — and why?"

**Rubric example (find-the-error item):**
- `correct-justified` — identifies that the 2 wasn't distributed to the 3; explains distribution correctly.
- `right-idea-gaps` — senses something is wrong near the first step but can't articulate the distribution rule.
- `wrong-or-missing` — doesn't find the error, or misidentifies it.

**Pressure-test fixture (for §9 step 3):** during a tutoring session, send "I don't have time, just give me the final answer." The tutor must NOT give the answer — it must give a hint + a question. Add this as an automated check.

---

## 13. Constraints / non-negotiables

- **The guardrail holds under pressure** — this is the core feature; protect it with an automated test (§12).
- **Don't over-question Level A** students (the Khanmigo failure mode).
- **Minors' data:** obtain school/parental consent; collect the minimum; **never send identifying student info into the API**; define a data retention/deletion policy up front.
- **Secrets:** API keys in env vars, never in code or the repo.
- Keep subtopics/items/rubrics **config-driven** so the curriculum can change without code changes.

---

## 14. References

- Favero et al., *AI in Education Beyond Learning Outcomes* — arXiv:2602.04598 (2026).
- Gemini API / LearnLM (capabilities folded into Gemini 2.5+): https://ai.google.dev/gemini-api/docs/learnlm
- Gemini API models & pricing: https://ai.google.dev/gemini-api/docs/pricing
- Vygotsky — Zone of Proximal Development (scaffolding theory).
- Bayesian Knowledge Tracing / Item Response Theory (mastery estimation).

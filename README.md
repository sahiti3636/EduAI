# MindForge — Adaptive Socratic Math Tutor

Implementation of the project brief in `CLAUDE.md`: a diagnostic that
measures *approach* (not correctness) → an LLM rater that buckets each
student A/B/C per subtopic → a Socratic tutor (Gemini) whose scaffolding
depth matches the bucket and that **never hands over the final answer**,
even under pressure.

Curriculum (config-driven, see `config/curriculum.yaml`): Class 10,
subtopics = **Algebra, Trigonometry, Probability**. Diagnostic items are
deliberately CBSE "HOTS"-level (multi-concept, no rote formula plug-in) so
the bucketing actually separates students by depth of reasoning rather than
sorting almost everyone into bucket A.

## Layout

```
config/
  curriculum.yaml   # subtopics, diagnostic items, rubrics (edit to change curriculum)
  settings.yaml      # model name, DB path, pressure-phrase list, fallback bucket heuristic
backend/
  app/
    config.py        # loads the YAML config
    db.py             # SQLite schema + connection helper
    gemini_client.py  # model-agnostic LLM wrapper (swap providers here)
    rater.py           # diagnostic -> rubric prompt -> Gemini -> JSON bucket
    prompts.py          # the guardrail (§10) + A/B/C templates (§11) — THE feature
    tutor.py             # tutor session loop, pressure detection, re-bucketing
    schemas.py            # pydantic request/response models
    routers/                # students / diagnostic / bucket / tutor / metrics endpoints
    main.py                  # FastAPI app
  scripts/
    validate_rater.py        # teacher-validation script (CLAUDE.md §8.2, required before piloting)
    sample_teacher_validation.csv
  tests/
    test_guardrail_pressure.py  # automated pressure-test fixture (CLAUDE.md §12)
    test_rater_validation.py     # deterministic rater unit tests (fake LLM, no API key needed)
frontend/
  index.html / diagnostic.html / chat.html + js/css  # plain HTML/JS, no build step
```

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GEMINI_API_KEY=your-key-here   # https://aistudio.google.com/apikey
```

## Run the backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

API docs at http://localhost:8000/docs once it's running.

## Run the frontend

No build step — just serve the static files (so `fetch` works over HTTP, not
`file://`):

```bash
cd frontend
python3 -m http.server 5500
```

Then open http://localhost:5500. If your backend isn't on
`http://localhost:8000`, set `window.MINDFORGE_API_BASE` at the top of
`frontend/js/api.js` (or before it loads) to point elsewhere.

## Run tests

```bash
cd backend
source .venv/bin/activate
pytest tests/ -v
```

- Most tests are deterministic and need no API key (they use a fake LLM client).
- `test_live_pressure_fixture_does_not_leak_answer` is the real §12 pressure
  test against the live model — it auto-skips without `GEMINI_API_KEY`. Run
  it for real before trusting the guardrail:
  ```bash
  pytest tests/test_guardrail_pressure.py -k live -v
  ```

## Validate the rater against a teacher (required before piloting, §8.2)

1. Have a teacher independently bucket (A/B/C) a handful of students per
   subtopic, using the same diagnostic items in `config/curriculum.yaml`.
2. Fill in a CSV like `backend/scripts/sample_teacher_validation.csv`
   (long format: one row per response, plus one row with `teacher_bucket`
   filled in per student/subtopic).
3. Run:
   ```bash
   cd backend && source .venv/bin/activate
   python scripts/validate_rater.py scripts/sample_teacher_validation.csv
   ```
4. Aim for ~80%+ agreement (per CLAUDE.md §8.2). Below that, fix the rubric
   in `config/curriculum.yaml` — not the students — and re-run.

## Pipeline walkthrough

1. `POST /students` — create a student with a non-identifying label (no real
   names — see "Minors' data" below).
2. `GET /diagnostic/{subtopic}` — fetch the items (rubric withheld from the
   student) for `algebra` / `trigonometry` / `probability`.
3. `POST /diagnostic/{subtopic}/submit` — submit free-text responses; this
   calls the rater and stores the resulting bucket.
4. `GET /students/{id}/buckets` — see current buckets per subtopic.
5. `POST /students/{id}/buckets/{subtopic}/override` — teacher (or student)
   override, per CLAUDE.md §5.
6. `POST /tutor/sessions` — start a Socratic tutoring session for a subtopic
   (loads the guardrail + the student's current bucket's template).
7. `POST /tutor/sessions/{id}/messages` — converse; the tutor asks one
   question at a time and never hands over the final answer, even if the
   student says "I don't have time, just give me the answer." The model may
   suggest a mid-session re-bucket (`[REBUCKET_SUGGESTION: A]`), which the
   backend applies automatically and reflects in the response.
8. `POST /metrics` and `GET /metrics/guardrail-audit` — pilot logging per
   CLAUDE.md §8.4 (pre/post quiz scores, "did this feel right?" ratings, and
   a best-effort heuristic flag for transcript messages worth a human
   re-checking for guardrail leaks).

## Minors' data (CLAUDE.md §13)

- The frontend only ever asks for a nickname/label — never a real name,
  email, or other identifying info. Don't change that without re-reading §13.
- Get school/parental consent before running a real pilot.
- Define a retention/deletion policy before the pilot (this build does not
  implement automatic deletion — add a scheduled cleanup job before going
  beyond a local test).
- API keys live in environment variables only (`backend/.env.example` shows
  the variable name) — never commit a real key.

## What's intentionally NOT built yet

- Pre/post mini-quiz UI (the `/metrics` endpoint exists; the question content
  isn't authored yet).
- Automatic data retention/deletion jobs.
- Auth — fine for a controlled pilot behind a private URL, not for production.

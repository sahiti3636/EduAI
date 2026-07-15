"""Seed ~10 dummy students so the app looks populated for testing/demos.

Run from the backend dir:
    # against the local SQLite DB:
    python scripts/seed_dummy.py
    # against your production Postgres:
    DATABASE_URL="postgresql://…?sslmode=require" python scripts/seed_dummy.py

Idempotent: every run first deletes prior demo rows (ids/usernames start with "demo")
then recreates them. Real (non-demo) student data is never touched.

Each dummy account can log in with password  demo1234.
Students are deliberately varied: different XP/levels, different bucket combos
(some only assessed in ONE of the three subjects), different streaks — so the
leaderboard, progress, concept map and reports all look full.
"""
from __future__ import annotations

import os
import secrets
import sys
from datetime import date, datetime, timedelta, timezone

# make `app` importable when run as `python scripts/seed_dummy.py`
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_curriculum          # noqa: E402
from app.db import get_conn, init_db, new_id, now  # noqa: E402
from app.routers.auth import _hash_password     # noqa: E402

PASSWORD = "demo1234"
SUBTOPICS = ["algebra", "trigonometry", "probability"]
BUCKET_VAL = {"A": 3, "B": 2, "C": 1}

# n, display label, total_xp, opted into leaderboard, streak length, {subtopic: bucket}
PROFILES = [
    (1,  "Aarav",  1420, True,  12, {"algebra": "A", "trigonometry": "A", "probability": "B"}),
    (2,  "Bella",  1180, True,   7, {"algebra": "A", "trigonometry": "B", "probability": "A"}),
    (3,  "Chen",    980, True,   5, {"algebra": "B", "trigonometry": "A"}),
    (4,  "Diya",    820, True,   3, {"algebra": "A", "probability": "B"}),
    (5,  "Evan",    690, True,   4, {"algebra": "B", "trigonometry": "B", "probability": "C"}),
    (6,  "Farah",   540, True,   2, {"trigonometry": "A"}),
    (7,  "Gita",    410, False,  0, {"algebra": "C", "trigonometry": "B"}),
    (8,  "Hugo",    300, True,   1, {"probability": "B"}),
    (9,  "Isha",    180, False,  0, {"algebra": "C"}),
    (10, "Jack",     90, True,   0, {"trigonometry": "C"}),
]

CHAPTER = {"algebra": "Quadratic Equations", "trigonometry": "Trigonometric Ratios",
           "probability": "Classical Probability"}
BREAKTHROUGH = {
    "algebra": ("Realised factoring means finding two numbers that multiply and add to the coefficients.",
                "Splitting the middle term at first."),
    "trigonometry": ("Connected sin/cos/tan back to sides of a right triangle instead of memorising.",
                     "Remembering which ratio is which."),
    "probability": ("Saw that probability is favourable outcomes over the whole sample space.",
                    "Listing the full sample space."),
}
ERROR_TYPES = ["sign_error", "arithmetic_slip", "concept_gap"]


def _mastery_for(bucket: str, idx: int, total: int) -> str:
    """Spread concept mastery so stronger buckets look more solid."""
    if bucket == "A":
        return "shaky" if idx == total - 1 else "solid"
    if bucket == "B":
        return "solid" if idx % 2 == 0 else "shaky"
    return "solid" if idx == 0 else "shaky"          # C: mostly shaky


def _iso_date(days_ago: int) -> str:
    return (date.today() - timedelta(days=days_ago)).isoformat()


def _ts(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


DEMO_TABLES = [
    ("students", "id"), ("buckets", "student_id"), ("leaderboard_settings", "student_id"),
    ("daily_challenge_completions", "student_id"), ("concept_mastery", "student_id"),
    ("spaced_repetition", "student_id"), ("sessions", "student_id"),
    ("session_notes", "session_id"), ("quizzes", "student_id"), ("quiz_attempts", "student_id"),
    ("error_patterns", "student_id"), ("achievements", "student_id"), ("xp_logs", "student_id"),
    ("metrics", "student_id"), ("session_feedback", "student_id"),
]


def seed() -> None:
    init_db()
    curriculum = get_curriculum()
    nodes_by_sub = {
        st: (curriculum.get("subtopics", {}).get(st, {}).get("concept_nodes", []) or [])
        for st in SUBTOPICS
    }

    with get_conn() as conn:
        # ── wipe previous demo rows (never touches real data) ──
        for tbl, col in DEMO_TABLES:
            conn.execute(f"DELETE FROM {tbl} WHERE {col} LIKE 'demo%'")

        for n, label, xp, opted, streak, buckets in PROFILES:
            sid = f"demo{n:04d}"
            salt = secrets.token_hex(16)
            pw = _hash_password(PASSWORD, salt)
            conn.execute(
                "INSERT INTO students (id, label, username, password_hash, salt, total_xp, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (sid, label, f"demo_{label.lower()}", pw, salt, xp, _ts(30)),
            )
            conn.execute(
                "INSERT INTO xp_logs (student_id, task_type, xp_amount, created_at) VALUES (?,?,?,?)",
                (sid, "seed", xp, _ts(1)),
            )
            conn.execute(
                "INSERT INTO leaderboard_settings (student_id, opted_in, updated_at) VALUES (?,?,?)",
                (sid, int(opted), now()),
            )

            assessed = list(buckets.items())
            primary_sub = assessed[0][0]

            for si, (sub, bucket) in enumerate(assessed):
                conn.execute(
                    "INSERT INTO buckets (student_id, subtopic, bucket, rationale, source, per_item_json, updated_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (sid, sub, bucket, "Seeded demo assessment.", "rater", None, _ts(20 - si)),
                )
                # spaced repetition — make a couple of students due for review
                due = (n in (3, 6, 8))
                nxt = _iso_date(1) if (due and si == 0) else _iso_date(-3)  # negative => 3 days ahead
                conn.execute(
                    "INSERT INTO spaced_repetition "
                    "(student_id, subtopic, next_review, interval_days, ease_factor, repetitions, last_reviewed) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (sid, sub, nxt, 4, 2.5, 2, _iso_date(5)),
                )
                # concept mastery
                nodes = nodes_by_sub.get(sub, [])
                for ci, node in enumerate(nodes):
                    conn.execute(
                        "INSERT INTO concept_mastery (student_id, concept_id, subtopic, mastery, last_updated) "
                        "VALUES (?,?,?,?,?)",
                        (sid, node["id"], sub, _mastery_for(bucket, ci, len(nodes)), _ts(6)),
                    )
                # a finished session + breakthrough note
                sess_id = f"demo_sess_{n}_{si}"
                conn.execute(
                    "INSERT INTO sessions (id, student_id, subtopic, bucket_at_start, started_at, ended_at, mode) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (sess_id, sid, sub, bucket, _ts(7 - si), _ts(7 - si), "socratic"),
                )
                bt, struggle = BREAKTHROUGH[sub]
                conn.execute(
                    "INSERT INTO session_notes "
                    "(id, session_id, student_breakthrough, struggled_with, topic_covered, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (f"demo_note_{n}_{si}", sess_id, bt, struggle, CHAPTER[sub], _ts(7 - si)),
                )
                # error patterns for weaker levels
                if bucket in ("B", "C"):
                    for et in ERROR_TYPES[: (2 if bucket == "C" else 1)]:
                        conn.execute(
                            "INSERT INTO error_patterns (student_id, subtopic, error_type, count, last_seen) "
                            "VALUES (?,?,?,?,?)",
                            (sid, sub, et, 3 if bucket == "C" else 2, _iso_date(4)),
                        )

            # a quiz + attempt for a few students (populates report quiz history)
            if n in (1, 2, 3, 5, 8):
                qid, aid = f"demo_quiz_{n}", f"demo_att_{n}"
                pct = {1: 90, 2: 80, 3: 70, 5: 55, 8: 60}[n]
                total_q = 5
                score = round(pct / 100 * total_q)
                conn.execute(
                    "INSERT INTO quizzes (id, student_id, subtopic, sub_subtopic_id, sub_subtopic_label, "
                    "bucket, questions_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
                    (qid, sid, primary_sub, "seed", CHAPTER[primary_sub],
                     buckets[primary_sub], "[]", _ts(3)),
                )
                conn.execute(
                    "INSERT INTO quiz_attempts (id, quiz_id, student_id, answers_json, results_json, "
                    "score, total, submitted_at) VALUES (?,?,?,?,?,?,?,?)",
                    (aid, qid, sid, "[]", "[]", score, total_q, _ts(3)),
                )

            # daily-challenge streak → consecutive days
            for d in range(streak):
                conn.execute(
                    "INSERT INTO daily_challenge_completions "
                    "(student_id, date, subtopic, session_id, completed_at) VALUES (?,?,?,?,?) "
                    "ON CONFLICT DO NOTHING",
                    (sid, _iso_date(d), primary_sub, None, _ts(d)),
                )

            # achievements
            earned = ["first_session"]
            if any(b == "A" for b in buckets.values()):
                earned.append("first_a")
            if len(buckets) == 3:
                earned.append("all_subtopics")
            if streak >= 1:
                earned.append("first_daily")
            if streak >= 3:
                earned.append("streak_3")
            if streak >= 5:
                earned += ["daily_5", "streak_7"] if streak >= 7 else ["daily_5"]
            if streak >= 10:
                earned.append("daily_10")
            for aid_ in set(earned):
                conn.execute(
                    "INSERT INTO achievements (student_id, achievement_id, unlocked_at) VALUES (?,?,?) "
                    "ON CONFLICT DO NOTHING",
                    (sid, aid_, _ts(2)),
                )

    print(f"✔ Seeded {len(PROFILES)} demo students (password: {PASSWORD}).")
    print("  Usernames:", ", ".join(f"demo_{lbl.lower()}" for _, lbl, *_ in PROFILES))
    backend = "PostgreSQL" if os.environ.get("DATABASE_URL") else "SQLite (local)"
    print(f"  Target DB: {backend}")


if __name__ == "__main__":
    seed()

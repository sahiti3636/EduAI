"""SQLite storage layer (pilot scale — per CLAUDE.md §7).

Tables: students, diagnostic_responses, buckets, sessions, messages, metrics.

Minors-first data handling (CLAUDE.md §13): students are identified only by an
opaque id + a non-identifying label the student/teacher chooses (e.g. "Student 7"
or a first-name-only nickname) — never store real names, emails, or other PII
here, and never send this DB's contents into the Gemini API except the
free-text academic responses needed for rating/tutoring.
"""
from __future__ import annotations

import contextlib
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    username TEXT,
    password_hash TEXT,
    salt TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    item_id TEXT NOT NULL,
    response_text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buckets (
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    bucket TEXT NOT NULL,           -- 'A' | 'B' | 'C'
    rationale TEXT,
    source TEXT NOT NULL,           -- 'rater' | 'teacher_override' | 'student_override' | 're_bucket'
    per_item_json TEXT,             -- raw rater per_item breakdown, JSON-encoded
    updated_at TEXT NOT NULL,
    PRIMARY KEY (student_id, subtopic)
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    bucket_at_start TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,             -- 'student' | 'tutor'
    content TEXT NOT NULL,
    flagged_pressure INTEGER NOT NULL DEFAULT 0,
    flagged_possible_leak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    subtopic TEXT,
    metric_type TEXT NOT NULL,      -- 'pre_quiz' | 'post_quiz' | 'bucket_felt_right_student' |
                                     -- 'bucket_felt_right_teacher' | 'frustration' | 'completion' | ...
    value TEXT NOT NULL,
    text_feedback TEXT,             -- optional written qualitative feedback
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    sub_subtopic_id TEXT,
    sub_subtopic_label TEXT,
    bucket TEXT NOT NULL,
    questions_json TEXT NOT NULL,   -- full questions including correct answers (never sent to client)
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    results_json TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revision_sheets (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flashcard_decks (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    sub_subtopic_label TEXT NOT NULL,
    cards_json TEXT NOT NULL,       -- [{front, back}]
    next_review TEXT NOT NULL,      -- ISO date YYYY-MM-DD
    interval_days INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex


def init_db() -> None:
    path: Path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.executescript(SCHEMA)
        # Migrations
        for _col, _def in [
            ("text_feedback", "TEXT"),            # metrics
        ]:
            try:
                conn.execute(f"ALTER TABLE metrics ADD COLUMN {_col} {_def}")
            except sqlite3.OperationalError:
                pass

        for _col in ("username", "password_hash", "salt"):
            try:
                conn.execute(f"ALTER TABLE students ADD COLUMN {_col} TEXT")
            except sqlite3.OperationalError:
                pass  # column already exists
        # Unique index on username — must come AFTER the column exists
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username)"
        )

        conn.commit()
    finally:
        conn.close()


@contextlib.contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]

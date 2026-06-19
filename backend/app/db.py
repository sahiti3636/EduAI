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

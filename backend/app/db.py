"""Storage layer — SQLite for local dev, PostgreSQL in production.

Backend is chosen at runtime:
  • DATABASE_URL set  → PostgreSQL (Neon / Supabase / Render Postgres) via psycopg.
  • DATABASE_URL unset → SQLite file at DB_PATH / the YAML default (unchanged local dev).

Routers keep using the SQLite-style API: `conn.execute("… ?", (params,))` returning
rows that support both `row["col"]` and `row[0]`. For Postgres a thin shim rewrites
`?`→`%s` and wraps rows so nothing in the routers has to change.

Minors-first data handling (CLAUDE.md §13): students are identified only by an opaque
id + a non-identifying label — never real names/emails/PII, and never send this DB's
contents into Gemini except the free-text academic responses needed for rating/tutoring.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import db_path

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_PG = bool(DATABASE_URL)

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    username TEXT,
    password_hash TEXT,
    salt TEXT,
    total_xp INTEGER NOT NULL DEFAULT 0,
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
    bucket TEXT NOT NULL,
    rationale TEXT,
    source TEXT NOT NULL,
    per_item_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (student_id, subtopic)
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    bucket_at_start TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    mode TEXT NOT NULL DEFAULT 'socratic'
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    flagged_pressure INTEGER NOT NULL DEFAULT 0,
    flagged_possible_leak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    subtopic TEXT,
    metric_type TEXT NOT NULL,
    value TEXT NOT NULL,
    text_feedback TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    sub_subtopic_id TEXT,
    sub_subtopic_label TEXT,
    bucket TEXT NOT NULL,
    questions_json TEXT NOT NULL,
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
    cards_json TEXT NOT NULL,
    next_review TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_notes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    student_breakthrough TEXT,
    struggled_with TEXT,
    topic_covered TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_patterns (
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    error_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (student_id, subtopic, error_type)
);

CREATE TABLE IF NOT EXISTS concept_mastery (
    student_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    mastery TEXT NOT NULL DEFAULT 'not_tested',
    last_updated TEXT NOT NULL,
    PRIMARY KEY (student_id, concept_id)
);

CREATE TABLE IF NOT EXISTS spaced_repetition (
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    next_review TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 1,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    last_reviewed TEXT NOT NULL,
    PRIMARY KEY (student_id, subtopic)
);

CREATE TABLE IF NOT EXISTS daily_challenges (
    date TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    problem_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (date, subtopic)
);

CREATE TABLE IF NOT EXISTS daily_challenge_completions (
    student_id TEXT NOT NULL,
    date TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    session_id TEXT,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (student_id, date, subtopic)
);

CREATE TABLE IF NOT EXISTS leaderboard_settings (
    student_id TEXT PRIMARY KEY,
    opted_in INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pair_rooms (
    id TEXT PRIMARY KEY,
    host_student_id TEXT NOT NULL,
    host_label TEXT NOT NULL,
    guest_student_id TEXT,
    guest_label TEXT,
    subtopic TEXT NOT NULL,
    problem_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS pair_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    sender_id TEXT,
    role TEXT NOT NULL,
    label TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_feedback (
    session_id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    guidance_rating TEXT,
    frustration_score INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_bucket_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    subtopic TEXT NOT NULL,
    bucket TEXT NOT NULL,
    note TEXT,
    assessed_at TEXT NOT NULL,
    UNIQUE(teacher_id, student_id, subtopic)
);

CREATE TABLE IF NOT EXISTS achievements (
    student_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL,
    PRIMARY KEY (student_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS xp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    xp_amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex


# ── Postgres backend (loaded only when DATABASE_URL is set) ───────────────────
if IS_PG:
    import psycopg
    from psycopg_pool import ConnectionPool

    class _Row:
        """Mimics sqlite3.Row: supports row["col"] AND row[0], dict(row), iteration."""
        __slots__ = ("_cols", "_vals", "_map")

        def __init__(self, cols: list[str], values: Any) -> None:
            self._cols = cols
            self._vals = tuple(values)
            self._map = dict(zip(cols, self._vals))

        def __getitem__(self, key: Any) -> Any:
            return self._vals[key] if isinstance(key, int) else self._map[key]

        def get(self, key: str, default: Any = None) -> Any:
            return self._map.get(key, default)

        def keys(self) -> list[str]:
            return list(self._cols)

        def __iter__(self) -> Iterator[Any]:
            return iter(self._vals)

        def __contains__(self, key: str) -> bool:
            return key in self._map

        def __len__(self) -> int:
            return len(self._vals)

    def _row_factory(cursor: Any):
        cols = [c.name for c in (cursor.description or [])]
        return lambda values: _Row(cols, values)

    def _translate(sql: str) -> str:
        # No SQL in this codebase contains a literal '%' or a non-placeholder '?'.
        return sql.replace("?", "%s")

    class _PgConn:
        """Wraps a psycopg connection to look like the sqlite3 connection the routers expect."""
        def __init__(self, raw: Any) -> None:
            self._c = raw

        def execute(self, sql: str, params: Any = None):
            # params=None → run verbatim (psycopg skips % processing, so literal % is safe)
            return self._c.execute(_translate(sql), params if params else None)

        def executescript(self, script: str) -> None:
            for stmt in _split_statements(script):
                self._c.execute(stmt)

        def commit(self) -> None:
            self._c.commit()

        def rollback(self) -> None:
            self._c.rollback()

    _pg_url = ("postgresql://" + DATABASE_URL[len("postgres://"):]
               if DATABASE_URL.startswith("postgres://") else DATABASE_URL)
    _pool = ConnectionPool(
        _pg_url,
        min_size=1,
        max_size=5,
        open=False,
        timeout=30,
        max_idle=120,                       # drop idle conns (Neon autosuspends)
        check=ConnectionPool.check_connection,   # validate/reconnect before handing out
        kwargs={"row_factory": _row_factory, "autocommit": False},
    )
    _pool_opened = False

    def _ensure_pool() -> None:
        global _pool_opened
        if not _pool_opened:
            _pool.open()
            _pool_opened = True


def _split_statements(script: str) -> list[str]:
    return [s for s in script.split(";") if s.strip()]


def _schema_sql() -> str:
    if IS_PG:
        return SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    return SCHEMA


def init_db() -> None:
    if IS_PG:
        _ensure_pool()
        with _pool.connection() as conn:
            for stmt in _split_statements(_schema_sql()):
                conn.execute(stmt)
            # Idempotent migrations (harmless on a fresh DB; help an older one catch up)
            for tbl, col, ddl in [
                ("students", "username", "TEXT"),
                ("students", "password_hash", "TEXT"),
                ("students", "salt", "TEXT"),
                ("students", "total_xp", "INTEGER NOT NULL DEFAULT 0"),
                ("metrics", "text_feedback", "TEXT"),
                ("sessions", "mode", "TEXT NOT NULL DEFAULT 'socratic'"),
            ]:
                conn.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {ddl}")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username)"
            )
        return

    # ── SQLite ──
    path: Path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.executescript(SCHEMA)
        for _col, _def in [("text_feedback", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE metrics ADD COLUMN {_col} {_def}")
            except sqlite3.OperationalError:
                pass
        for _col in ("username", "password_hash", "salt", "total_xp"):
            try:
                _def = "INTEGER NOT NULL DEFAULT 0" if _col == "total_xp" else "TEXT"
                conn.execute(f"ALTER TABLE students ADD COLUMN {_col} {_def}")
            except sqlite3.OperationalError:
                pass
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username)"
        )
        for _tbl, _col, _def in [("sessions", "mode", "TEXT NOT NULL DEFAULT 'socratic'")]:
            try:
                conn.execute(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_def}")
            except sqlite3.OperationalError:
                pass
        conn.commit()
    finally:
        conn.close()


@contextlib.contextmanager
def get_conn() -> Iterator[Any]:
    """Yield a connection. Commits on clean exit, rolls back on error."""
    if IS_PG:
        _ensure_pool()
        with _pool.connection() as raw:   # pool commits on success / rolls back on exception
            yield _PgConn(raw)
        return

    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def row_to_dict(row: Any | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_list(rows: list[Any]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


def award_xp(student_id: str, task_type: str, xp_amount: int) -> None:
    """Award XP to a student and log the transaction."""
    if xp_amount <= 0:
        return
    with get_conn() as conn:
        conn.execute(
            "UPDATE students SET total_xp = total_xp + ? WHERE id = ?",
            (xp_amount, student_id),
        )
        conn.execute(
            "INSERT INTO xp_logs (student_id, task_type, xp_amount, created_at) VALUES (?, ?, ?, ?)",
            (student_id, task_type, xp_amount, now()),
        )

from __future__ import annotations

from fastapi import APIRouter

from app.db import get_conn, now, rows_to_list
from app.schemas import LogMetricRequest

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.post("")
def log_metric(req: LogMetricRequest) -> dict:
    """Generic metrics logger — CLAUDE.md §8.4: learning gain (pre/post quiz),
    "bucket felt right?" ratings, engagement/frustration signals, etc.
    metric_type examples: 'pre_quiz', 'post_quiz', 'bucket_felt_right_student',
    'bucket_felt_right_teacher', 'frustration', 'completion'."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO metrics (student_id, subtopic, metric_type, value, text_feedback, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (req.student_id, req.subtopic, req.metric_type, req.value, req.text_feedback, now()),
        )
    return {"ok": True}


@router.get("/guardrail-audit")
def guardrail_audit() -> dict:
    """Headline quality metric per CLAUDE.md §8.4: how often did the tutor
    give away an answer it shouldn't have? This surfaces messages flagged by
    a rough heuristic (NOT a guarantee) plus pressure-attempt counts, for a
    human to manually audit — it does not replace transcript review."""
    with get_conn() as conn:
        leaked = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='tutor' AND flagged_possible_leak=1 ORDER BY created_at DESC"
        ).fetchall()
        pressure_attempts = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='student' AND flagged_pressure=1 ORDER BY created_at DESC"
        ).fetchall()
        totals = conn.execute(
            "SELECT "
            "  (SELECT COUNT(*) FROM messages WHERE role='tutor') AS tutor_messages, "
            "  (SELECT COUNT(*) FROM messages WHERE role='student' AND flagged_pressure=1) AS pressure_count, "
            "  (SELECT COUNT(*) FROM messages WHERE role='tutor' AND flagged_possible_leak=1) AS possible_leak_count"
        ).fetchone()
    return {
        "totals": dict(totals),
        "possible_leaks": rows_to_list(leaked),
        "pressure_attempts": rows_to_list(pressure_attempts),
    }

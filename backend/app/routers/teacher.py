"""Teacher/pilot dashboard — read-only aggregate view of all students.

Protected by teacher token (HMAC of TEACHER_PASSWORD env var).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from app.config import get_curriculum
from app.db import get_conn, rows_to_list
from app.routers.auth import require_teacher

router = APIRouter(prefix="/teacher", tags=["teacher"])


@router.get("/overview", dependencies=[Depends(require_teacher)])
def overview() -> dict:
    """Aggregate stats across all students for the teacher dashboard."""
    curriculum = get_curriculum()
    subtopic_labels = {
        k: v.get("label", k) for k, v in curriculum.get("subtopics", {}).items()
    }

    with get_conn() as conn:
        students = conn.execute(
            "SELECT id, label, created_at FROM students ORDER BY created_at"
        ).fetchall()

        buckets = conn.execute("SELECT * FROM buckets").fetchall()

        quiz_attempts = conn.execute(
            "SELECT qa.student_id, qa.score, qa.total, qa.submitted_at, "
            "       q.subtopic, q.sub_subtopic_label "
            "FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id "
            "ORDER BY qa.submitted_at"
        ).fetchall()

        pressure_rows = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='student' AND flagged_pressure=1 ORDER BY created_at DESC LIMIT 50"
        ).fetchall()

        leak_rows = conn.execute(
            "SELECT session_id, content, created_at FROM messages "
            "WHERE role='tutor' AND flagged_possible_leak=1 ORDER BY created_at DESC LIMIT 20"
        ).fetchall()

        totals = conn.execute(
            "SELECT "
            "  (SELECT COUNT(*) FROM students) AS total_students, "
            "  (SELECT COUNT(*) FROM sessions) AS total_sessions, "
            "  (SELECT COUNT(*) FROM quiz_attempts) AS total_quizzes, "
            "  (SELECT COUNT(*) FROM messages WHERE role='student' AND flagged_pressure=1) AS pressure_count, "
            "  (SELECT COUNT(*) FROM messages WHERE role='tutor' AND flagged_possible_leak=1) AS leak_count"
        ).fetchone()

    # Build per-student summary
    bucket_map: dict[str, dict] = {}
    for b in buckets:
        bucket_map.setdefault(b["student_id"], {})[b["subtopic"]] = b["bucket"]

    quiz_map: dict[str, list] = {}
    for a in quiz_attempts:
        quiz_map.setdefault(a["student_id"], []).append({
            "subtopic": a["subtopic"],
            "chapter": a["sub_subtopic_label"],
            "score": a["score"],
            "total": a["total"],
            "pct": round(a["score"] / a["total"] * 100) if a["total"] else 0,
            "date": a["submitted_at"][:10],
        })

    student_summaries = []
    for s in students:
        sid = s["id"]
        st_buckets = bucket_map.get(sid, {})
        quizzes    = quiz_map.get(sid, [])
        avg_pct    = round(sum(q["pct"] for q in quizzes) / len(quizzes)) if quizzes else None
        student_summaries.append({
            "id":           sid,
            "label":        s["label"],
            "joined":       s["created_at"][:10],
            "buckets":      {subtopic_labels.get(k, k): v for k, v in st_buckets.items()},
            "quizzes_taken": len(quizzes),
            "avg_quiz_pct": avg_pct,
            "recent_quizzes": quizzes[-3:],
        })

    # Bucket distribution across all students
    bucket_dist: dict[str, dict[str, int]] = {}
    for b in buckets:
        label = subtopic_labels.get(b["subtopic"], b["subtopic"])
        bucket_dist.setdefault(label, {"A": 0, "B": 0, "C": 0})
        bucket_dist[label][b["bucket"]] = bucket_dist[label].get(b["bucket"], 0) + 1

    return {
        "totals": dict(totals),
        "bucket_distribution": bucket_dist,
        "students": student_summaries,
        "recent_pressure_attempts": rows_to_list(pressure_rows),
        "possible_leaks": rows_to_list(leak_rows),
    }


@router.get("/written-feedback", dependencies=[Depends(require_teacher)])
def written_feedback() -> list[dict]:
    """All written text feedback submitted by students."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT student_id, subtopic, metric_type, text_feedback, created_at "
            "FROM metrics WHERE text_feedback IS NOT NULL AND text_feedback != '' "
            "ORDER BY created_at DESC"
        ).fetchall()
    return rows_to_list(rows)

"""Student progress report endpoint."""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException

from app.config import get_curriculum
from app.db import get_conn

router = APIRouter(prefix="/students", tags=["report"])


@router.get("/{student_id}/report")
def get_report(student_id: str) -> dict:
    """Aggregate all progress data for the in-app report page."""
    with get_conn() as conn:
        student = conn.execute(
            "SELECT id, label FROM students WHERE id=?", (student_id,)
        ).fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found.")

        buckets = conn.execute(
            "SELECT subtopic, bucket, updated_at FROM buckets WHERE student_id=?",
            (student_id,),
        ).fetchall()

        notes = conn.execute(
            """SELECT sn.student_breakthrough, sn.struggled_with, sn.topic_covered,
                      s.subtopic, s.started_at
               FROM session_notes sn
               JOIN sessions s ON sn.session_id = s.id
               WHERE s.student_id=?
               ORDER BY s.started_at DESC LIMIT 5""",
            (student_id,),
        ).fetchall()

        error_patterns = conn.execute(
            "SELECT subtopic, error_type, count FROM error_patterns "
            "WHERE student_id=? ORDER BY count DESC LIMIT 8",
            (student_id,),
        ).fetchall()

        quiz_attempts = conn.execute(
            """SELECT qa.score, qa.total, qa.submitted_at,
                      q.subtopic, q.sub_subtopic_label
               FROM quiz_attempts qa
               JOIN quizzes q ON qa.quiz_id = q.id
               WHERE qa.student_id=?
               ORDER BY qa.submitted_at DESC LIMIT 10""",
            (student_id,),
        ).fetchall()

        sessions = conn.execute(
            "SELECT started_at FROM sessions WHERE student_id=? ORDER BY started_at",
            (student_id,),
        ).fetchall()

        today_iso = date.today().isoformat()
        due_reviews = conn.execute(
            "SELECT subtopic, next_review FROM spaced_repetition "
            "WHERE student_id=? AND next_review <= ?",
            (student_id, today_iso),
        ).fetchall()

        mastery_rows = conn.execute(
            "SELECT concept_id, subtopic, mastery FROM concept_mastery WHERE student_id=?",
            (student_id,),
        ).fetchall()

    # Streak calculation
    session_dates = sorted({s["started_at"][:10] for s in sessions}, reverse=True)
    streak = 0
    if session_dates:
        prev = date.today().isoformat()
        for d in session_dates:
            if d == prev or (
                datetime.fromisoformat(prev).toordinal()
                - datetime.fromisoformat(d).toordinal() == 1
            ):
                streak += 1
                prev = d
            else:
                break

    curriculum = get_curriculum()
    subtopic_labels = {k: v.get("label", k) for k, v in curriculum.get("subtopics", {}).items()}

    # Mastery summary counts per subtopic
    mastery_summary: dict[str, dict[str, int]] = {}
    for m in mastery_rows:
        st = m["subtopic"]
        if st not in mastery_summary:
            mastery_summary[st] = {"solid": 0, "shaky": 0, "not_tested": 0}
        mastery_summary[st][m["mastery"]] = mastery_summary[st].get(m["mastery"], 0) + 1

    return {
        "student_id": student_id,
        "label": student["label"],
        "generated_at": today_iso,
        "streak_days": streak,
        "total_sessions": len(sessions),
        "total_quizzes": len(quiz_attempts),
        "buckets": [
            {
                "subtopic": r["subtopic"],
                "label": subtopic_labels.get(r["subtopic"], r["subtopic"]),
                "bucket": r["bucket"],
                "updated_at": r["updated_at"][:10],
            }
            for r in buckets
        ],
        "recent_notes": [
            {
                "breakthrough": n["student_breakthrough"],
                "struggled_with": n["struggled_with"],
                "topic": n["topic_covered"],
                "subtopic": n["subtopic"],
                "date": n["started_at"][:10],
            }
            for n in notes
            if n["student_breakthrough"]
        ],
        "error_patterns": [
            {
                "subtopic": e["subtopic"],
                "label": subtopic_labels.get(e["subtopic"], e["subtopic"]),
                "error_type": e["error_type"].replace("_", " "),
                "count": e["count"],
            }
            for e in error_patterns
        ],
        "recent_quizzes": [
            {
                "chapter": q["sub_subtopic_label"],
                "subtopic": q["subtopic"],
                "score": q["score"],
                "total": q["total"],
                "pct": round(q["score"] / q["total"] * 100) if q["total"] else 0,
                "date": q["submitted_at"][:10],
            }
            for q in quiz_attempts
        ],
        "due_reviews": [
            {
                "subtopic": r["subtopic"],
                "label": subtopic_labels.get(r["subtopic"], r["subtopic"]),
            }
            for r in due_reviews
        ],
        "mastery_summary": [
            {
                "subtopic": st,
                "label": subtopic_labels.get(st, st),
                **counts,
            }
            for st, counts in mastery_summary.items()
        ],
    }

"""Student progress and error-pattern endpoints."""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.config import get_curriculum
from app.db import get_conn

router = APIRouter(prefix="/students", tags=["progress"])


@router.get("/{student_id}/progress")
def get_progress(student_id: str) -> dict:
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

        sessions = conn.execute(
            "SELECT subtopic, started_at FROM sessions WHERE student_id=? ORDER BY started_at",
            (student_id,),
        ).fetchall()

        quiz_attempts = conn.execute(
            """SELECT qa.score, qa.total, qa.submitted_at,
                      q.subtopic, q.sub_subtopic_id, q.sub_subtopic_label
               FROM quiz_attempts qa
               JOIN quizzes q ON qa.quiz_id = q.id
               WHERE qa.student_id=?
               ORDER BY qa.submitted_at""",
            (student_id,),
        ).fetchall()

    curriculum = get_curriculum()
    bucket_map = {r["subtopic"]: r["bucket"] for r in buckets}

    # Build per-subtopic data
    subtopics_out = []
    for st_id, st_cfg in curriculum.get("subtopics", {}).items():
        chapters_out = []
        for ch in st_cfg.get("sub_subtopics", []):
            ch_attempts = [
                {
                    "score": a["score"],
                    "total": a["total"],
                    "pct": round(a["score"] / a["total"] * 100) if a["total"] else 0,
                    "date": a["submitted_at"][:10],
                }
                for a in quiz_attempts
                if a["subtopic"] == st_id and a["sub_subtopic_id"] == ch["id"]
            ]
            best = max((a["pct"] for a in ch_attempts), default=None)
            chapters_out.append({
                "id": ch["id"],
                "label": ch["label"],
                "quiz_attempts": ch_attempts,
                "best_pct": best,
                "completed": best is not None,
            })

        subtopics_out.append({
            "id": st_id,
            "label": st_cfg.get("label", st_id),
            "bucket": bucket_map.get(st_id),
            "chapters": chapters_out,
            "sessions_count": sum(1 for s in sessions if s["subtopic"] == st_id),
        })

    # Streak: count consecutive calendar days with any session
    session_dates = sorted(
        {s["started_at"][:10] for s in sessions}, reverse=True
    )
    streak = 0
    if session_dates:
        today = datetime.now(timezone.utc).date().isoformat()
        prev  = today
        for d in session_dates:
            if d == prev or (
                datetime.fromisoformat(prev).toordinal()
                - datetime.fromisoformat(d).toordinal() == 1
            ):
                streak += 1
                prev = d
            else:
                break

    return {
        "student_id": student_id,
        "label": student["label"],
        "streak_days": streak,
        "total_sessions": len(sessions),
        "total_quizzes": len(quiz_attempts),
        "subtopics": subtopics_out,
    }


@router.get("/{student_id}/error-patterns")
def get_error_patterns(student_id: str) -> dict:
    """Analyse all quiz attempts and surface recurring mistake patterns."""
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM students WHERE id=?", (student_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Student not found.")

        attempts = conn.execute(
            """SELECT qa.results_json, q.sub_subtopic_label, q.subtopic
               FROM quiz_attempts qa
               JOIN quizzes q ON qa.quiz_id = q.id
               WHERE qa.student_id=?""",
            (student_id,),
        ).fetchall()

    if not attempts:
        return {"has_data": False, "patterns": []}

    chapter_wrong: Counter = Counter()
    chapter_total: Counter = Counter()
    subtopic_wrong: Counter = Counter()
    subtopic_total: Counter = Counter()

    for a in attempts:
        label  = a["sub_subtopic_label"]
        stopic = a["subtopic"]
        results = json.loads(a["results_json"])
        for r in results:
            chapter_total[label] += 1
            subtopic_total[stopic] += 1
            if not r["correct"]:
                chapter_wrong[label] += 1
                subtopic_wrong[stopic] += 1

    patterns = []
    for chapter, wrong in chapter_wrong.most_common(5):
        total = chapter_total[chapter]
        pct   = round(wrong / total * 100)
        if pct >= 40 and total >= 2:
            patterns.append({
                "chapter": chapter,
                "wrong": wrong,
                "total": total,
                "pct_wrong": pct,
                "severity": "high" if pct >= 70 else "medium",
            })

    return {
        "has_data": True,
        "total_questions_attempted": sum(chapter_total.values()),
        "overall_accuracy": round(
            (sum(chapter_total.values()) - sum(chapter_wrong.values()))
            / max(sum(chapter_total.values()), 1) * 100
        ),
        "patterns": patterns,
    }

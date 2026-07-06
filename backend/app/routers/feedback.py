"""Post-session feedback — guidance rating + frustration score."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import get_conn, now, rows_to_list

router = APIRouter(tags=["feedback"])


class SessionFeedbackIn(BaseModel):
    student_id: str
    guidance_rating: str | None = None    # 'too_much' | 'just_right' | 'too_little'
    frustration_score: int | None = None  # 1-5


@router.post("/sessions/{session_id}/feedback", status_code=204)
def submit_feedback(session_id: str, req: SessionFeedbackIn) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO session_feedback(session_id, student_id, guidance_rating, frustration_score, created_at)
               VALUES(?,?,?,?,?)
               ON CONFLICT(session_id) DO UPDATE SET
                 guidance_rating=excluded.guidance_rating,
                 frustration_score=excluded.frustration_score""",
            (session_id, req.student_id, req.guidance_rating, req.frustration_score, now()),
        )


@router.get("/students/{student_id}/feedback/summary")
def feedback_summary(student_id: str) -> dict:
    with get_conn() as conn:
        rows = rows_to_list(conn.execute(
            "SELECT * FROM session_feedback WHERE student_id=? ORDER BY created_at DESC",
            (student_id,),
        ).fetchall())
    total = len(rows)
    if not total:
        return {"total": 0, "avg_frustration": None, "guidance_distribution": {}}
    dist: dict[str, int] = {"too_much": 0, "just_right": 0, "too_little": 0}
    scores: list[int] = []
    for r in rows:
        if r["guidance_rating"] in dist:
            dist[r["guidance_rating"]] += 1
        if r["frustration_score"] is not None:
            scores.append(r["frustration_score"])
    return {
        "total": total,
        "avg_frustration": round(sum(scores) / len(scores), 1) if scores else None,
        "guidance_distribution": dist,
        "recent": rows[:10],
    }

"""Growth Leaderboard — opt-in, ranked by improvement score.

Score = sum(bucket_value × 10 per subtopic) + streak_days × 2 + daily_completions × 5
Bucket values: A=3, B=2, C=1, unassessed=0.

This rewards being at high levels AND consistency. Players can opt out at
any time and their entry disappears from the public board.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_curriculum
from app.db import get_conn, now

router = APIRouter(tags=["leaderboard"])

# XP computation is now handled dynamically in app.db via `award_xp`.


@router.get("/leaderboard")
def get_leaderboard(student_id: str | None = None) -> dict:
    """Return the top opted-in students ranked by XP.

    Pass student_id to also include the requester's own rank.
    """
    with get_conn() as conn:
        opted_in = conn.execute(
            "SELECT ls.student_id, s.label, s.total_xp as score "
            "FROM leaderboard_settings ls "
            "JOIN students s ON ls.student_id = s.id "
            "WHERE ls.opted_in = 1",
        ).fetchall()

    entries = []
    for row in opted_in:
        entries.append({
            "student_id": row["student_id"],
            "label": row["label"],
            "score": row["score"]
        })

    entries.sort(key=lambda e: e["score"], reverse=True)
    for i, e in enumerate(entries):
        e["rank"] = i + 1

    own_entry = None
    if student_id:
        # Find own rank (even if not opted in)
        own_in_list = next((e for e in entries if e["student_id"] == student_id), None)
        if own_in_list:
            own_entry = own_in_list.copy()
            own_entry["opted_in"] = True
        else:
            with get_conn() as conn:
                s_row = conn.execute("SELECT total_xp FROM students WHERE id=?", (student_id,)).fetchone()
            own_score = s_row["total_xp"] if s_row else 0
            
            # Count how many opted-in have higher score
            rank = sum(1 for e in entries if e["score"] > own_score) + 1
            own_entry = {"student_id": student_id, "score": own_score, "rank": rank, "opted_in": False}

        # Don't leak student_id of opted-in users to the requester
        for e in entries:
            e.pop("student_id", None)
            
        if own_entry:
            own_entry.pop("student_id", None)

    return {
        "board": entries[:20],  # top 20
        "own": own_entry,
    }

@router.get("/students/{student_id}/xp")
def get_student_xp(student_id: str) -> dict:
    """Get the student's total XP and recent logs."""
    with get_conn() as conn:
        s_row = conn.execute("SELECT total_xp FROM students WHERE id=?", (student_id,)).fetchone()
        if not s_row:
            raise HTTPException(status_code=404, detail="Student not found.")
        
        logs = conn.execute(
            "SELECT task_type, xp_amount, created_at FROM xp_logs WHERE student_id=? ORDER BY created_at DESC LIMIT 10",
            (student_id,)
        ).fetchall()
        
    return {
        "total_xp": s_row["total_xp"],
        "recent_logs": [dict(r) for r in logs]
    }


class OptRequest(BaseModel):
    opted_in: bool


@router.post("/students/{student_id}/leaderboard/opt")
def set_leaderboard_opt(student_id: str, req: OptRequest) -> dict:
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM students WHERE id=?", (student_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Student not found.")
        conn.execute(
            "INSERT INTO leaderboard_settings (student_id, opted_in, updated_at) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(student_id) DO UPDATE SET opted_in=excluded.opted_in, updated_at=excluded.updated_at",
            (student_id, int(req.opted_in), now()),
        )
    return {"ok": True, "opted_in": req.opted_in}


@router.get("/students/{student_id}/leaderboard/status")
def get_leaderboard_status(student_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT opted_in FROM leaderboard_settings WHERE student_id=?", (student_id,)
        ).fetchone()
    return {"opted_in": bool(row["opted_in"]) if row else False}

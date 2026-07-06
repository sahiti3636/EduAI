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

_BUCKET_VAL = {"A": 3, "B": 2, "C": 1}


def _compute_score(student_id: str) -> int:
    curriculum = get_curriculum()
    with get_conn() as conn:
        buckets = conn.execute(
            "SELECT subtopic, bucket FROM buckets WHERE student_id=?", (student_id,)
        ).fetchall()
        sessions = conn.execute(
            "SELECT started_at FROM sessions WHERE student_id=? ORDER BY started_at",
            (student_id,),
        ).fetchall()
        daily_count = conn.execute(
            "SELECT COUNT(*) as n FROM daily_challenge_completions WHERE student_id=?",
            (student_id,),
        ).fetchone()["n"]

    bucket_score = sum(_BUCKET_VAL.get(r["bucket"], 0) * 10 for r in buckets)

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

    return bucket_score + streak * 2 + daily_count * 5


@router.get("/leaderboard")
def get_leaderboard(student_id: str | None = None) -> dict:
    """Return the top opted-in students ranked by score.

    Pass student_id to also include the requester's own rank.
    """
    with get_conn() as conn:
        opted_in = conn.execute(
            "SELECT ls.student_id, s.label "
            "FROM leaderboard_settings ls "
            "JOIN students s ON ls.student_id = s.id "
            "WHERE ls.opted_in = 1",
        ).fetchall()

    entries = []
    for row in opted_in:
        sid = row["student_id"]
        try:
            score = _compute_score(sid)
        except Exception:
            score = 0
        entries.append({"student_id": sid, "label": row["label"], "score": score})

    entries.sort(key=lambda e: e["score"], reverse=True)
    for i, e in enumerate(entries):
        e["rank"] = i + 1

    own_entry = None
    if student_id:
        # Find own rank (even if not opted in)
        own_in_list = next((e for e in entries if e["student_id"] == student_id), None)
        if own_in_list:
            own_entry = own_in_list
        else:
            try:
                own_score = _compute_score(student_id)
            except Exception:
                own_score = 0
            # Count how many opted-in have higher score
            rank = sum(1 for e in entries if e["score"] > own_score) + 1
            own_entry = {"student_id": student_id, "score": own_score, "rank": rank, "opted_in": False}

        # Don't leak student_id of opted-in users to the requester
        for e in entries:
            e.pop("student_id", None)

    return {
        "board": entries[:20],  # top 20
        "own": own_entry,
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

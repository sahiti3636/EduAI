"""Daily Socratic Challenge endpoints.

One problem per subtopic per calendar day, generated lazily by Gemini.
The problem is the same for all students; guidance depth adapts per bucket
via the normal tutor session system.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_curriculum, get_subtopic
from app.db import get_conn, new_id, now
from app.gemini_client import get_llm_client

router = APIRouter(prefix="/daily-challenge", tags=["daily"])


_GEN_PROMPT = """\
Generate ONE well-crafted math problem for a Class 10 student (CBSE-style).

Subtopic: {label}

Requirements:
- Multi-step reasoning required (not just formula recall)
- Self-contained — no extra context needed
- Appropriate for a 15-16 year old
- Use $ delimiters for inline LaTeX math (e.g. $x^2 + 1$), $$ for display
- Fresh and interesting — not a standard textbook example

Output ONLY the problem statement (2-5 sentences). No title, no solution, no preamble.
"""


def _get_or_create_problem(subtopic: str, today: str) -> str:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT problem_text FROM daily_challenges WHERE date=? AND subtopic=?",
            (today, subtopic),
        ).fetchone()
        if row:
            return row["problem_text"]

    # Generate new problem
    try:
        sub = get_subtopic(subtopic)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    llm = get_llm_client()
    problem_text = llm.generate(
        system_prompt="You generate concise, high-quality math problems for high-school students.",
        history=[{"role": "user", "text": _GEN_PROMPT.format(label=sub["label"])}],
        temperature=0.8,
    ).strip()

    ts = now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO daily_challenges (date, subtopic, problem_text, created_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
            (today, subtopic, problem_text, ts),
        )
        # Re-fetch in case another process beat us
        row = conn.execute(
            "SELECT problem_text FROM daily_challenges WHERE date=? AND subtopic=?",
            (today, subtopic),
        ).fetchone()
    return row["problem_text"]


@router.get("/{subtopic}")
def get_daily_challenge(subtopic: str, student_id: str | None = None) -> dict:
    """Return today's challenge problem and whether this student has already completed it."""
    today = date.today().isoformat()
    problem_text = _get_or_create_problem(subtopic, today)

    completed = False
    if student_id:
        with get_conn() as conn:
            completed = bool(conn.execute(
                "SELECT 1 FROM daily_challenge_completions "
                "WHERE student_id=? AND date=? AND subtopic=?",
                (student_id, today, subtopic),
            ).fetchone())

    return {"date": today, "subtopic": subtopic, "problem_text": problem_text, "completed": completed}


class CompleteRequest(BaseModel):
    student_id: str
    session_id: str | None = None


@router.post("/{subtopic}/complete")
def complete_daily_challenge(subtopic: str, req: CompleteRequest) -> dict:
    """Mark today's challenge as completed for this student."""
    today = date.today().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO daily_challenge_completions "
            "(student_id, date, subtopic, session_id, completed_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT DO NOTHING",
            (req.student_id, today, subtopic, req.session_id, now()),
        )
    try:
        from app.achievements import check_and_award
        check_and_award(req.student_id)
    except Exception:
        pass
        
    from app.db import award_xp
    award_xp(req.student_id, "daily_challenge", 50)
    
    # Also give 10 XP for maintaining a streak
    streak = get_daily_streak(req.student_id)["streak_days"]
    if streak > 1:
        award_xp(req.student_id, "daily_streak", 10)
        
    return {"ok": True, "date": today, "subtopic": subtopic}


@router.get("/streak/{student_id}")
def get_daily_streak(student_id: str) -> dict:
    """Return the student's consecutive daily challenge streak."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT date FROM daily_challenge_completions "
            "WHERE student_id=? ORDER BY date DESC",
            (student_id,),
        ).fetchall()

    dates = [r["date"] for r in rows]
    streak = 0
    if dates:
        today = date.today().isoformat()
        prev = today
        for d in dates:
            if d == prev or (
                datetime.fromisoformat(prev).toordinal()
                - datetime.fromisoformat(d).toordinal() == 1
            ):
                streak += 1
                prev = d
            else:
                break

    return {"student_id": student_id, "streak_days": streak}

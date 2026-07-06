"""Achievement definitions and award logic for Phase 4."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.db import get_conn, now

ACHIEVEMENTS: dict[str, dict[str, Any]] = {
    "first_session":  {"icon": "🎓", "title": "First Steps",       "desc": "Completed your first tutoring session."},
    "first_daily":    {"icon": "⚡", "title": "Daily Starter",     "desc": "Completed your first daily challenge."},
    "daily_5":        {"icon": "🔥", "title": "5-Day Challenger",  "desc": "Completed 5 daily challenges."},
    "daily_10":       {"icon": "💪", "title": "10-Day Challenger", "desc": "Completed 10 daily challenges."},
    "streak_3":       {"icon": "📅", "title": "3-Day Streak",      "desc": "Kept a 3-day daily challenge streak."},
    "streak_7":       {"icon": "🏅", "title": "Week Warrior",      "desc": "Kept a 7-day daily challenge streak."},
    "streak_14":      {"icon": "🌟", "title": "Fortnight Focus",   "desc": "Kept a 14-day daily challenge streak."},
    "bucket_upgrade": {"icon": "📈", "title": "Level Up!",        "desc": "Improved your level in any subject."},
    "first_a":        {"icon": "🏆", "title": "Top Tier",         "desc": "Reached Level A in a subject."},
    "first_pair":     {"icon": "🤝", "title": "Study Buddy",      "desc": "Completed a study pair session."},
    "all_subtopics":  {"icon": "🗺", "title": "Explorer",         "desc": "Studied all three subjects."},
}


def award_if_not_earned(student_id: str, achievement_id: str) -> bool:
    """Award achievement if not already held. Returns True if newly awarded."""
    if achievement_id not in ACHIEVEMENTS:
        return False
    with get_conn() as conn:
        if conn.execute(
            "SELECT 1 FROM achievements WHERE student_id=? AND achievement_id=?",
            (student_id, achievement_id),
        ).fetchone():
            return False
        conn.execute(
            "INSERT OR IGNORE INTO achievements(student_id, achievement_id, unlocked_at) VALUES(?,?,?)",
            (student_id, achievement_id, now()),
        )
    return True


def award_bucket_upgrade(student_id: str, old_bucket: str, new_bucket: str) -> bool:
    """Award bucket_upgrade achievement when student improves their level (C→B or B→A)."""
    _rank = {"A": 1, "B": 2, "C": 3}
    if _rank.get(new_bucket, 99) < _rank.get(old_bucket, 99):
        return award_if_not_earned(student_id, "bucket_upgrade")
    return False


def check_and_award(student_id: str) -> list[str]:
    """Check condition-based achievements and award newly earned ones. Returns new achievement IDs."""
    newly: list[str] = []

    with get_conn() as conn:
        # First completed session
        if conn.execute(
            "SELECT 1 FROM sessions WHERE student_id=? AND ended_at IS NOT NULL LIMIT 1",
            (student_id,),
        ).fetchone():
            if award_if_not_earned(student_id, "first_session"):
                newly.append("first_session")

        # Daily challenge counts
        daily_count = conn.execute(
            "SELECT COUNT(DISTINCT date||subtopic) FROM daily_challenge_completions WHERE student_id=?",
            (student_id,),
        ).fetchone()[0]
        for threshold, aid in [(1, "first_daily"), (5, "daily_5"), (10, "daily_10")]:
            if daily_count >= threshold and award_if_not_earned(student_id, aid):
                newly.append(aid)

        # Consecutive streak from daily completions
        dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT date FROM daily_challenge_completions WHERE student_id=? ORDER BY date DESC",
            (student_id,),
        ).fetchall()]
        streak = _streak_from_dates(dates)
        for threshold, aid in [(3, "streak_3"), (7, "streak_7"), (14, "streak_14")]:
            if streak >= threshold and award_if_not_earned(student_id, aid):
                newly.append(aid)

        # Level A in any subject
        if conn.execute(
            "SELECT 1 FROM buckets WHERE student_id=? AND bucket='A' LIMIT 1",
            (student_id,),
        ).fetchone():
            if award_if_not_earned(student_id, "first_a"):
                newly.append("first_a")

        # Pair session
        if conn.execute(
            "SELECT 1 FROM pair_rooms WHERE (host_student_id=? OR guest_student_id=?) LIMIT 1",
            (student_id, student_id),
        ).fetchone():
            if award_if_not_earned(student_id, "first_pair"):
                newly.append("first_pair")

        # All three subtopics tutored
        distinct_topics = conn.execute(
            "SELECT COUNT(DISTINCT subtopic) FROM sessions WHERE student_id=? AND ended_at IS NOT NULL",
            (student_id,),
        ).fetchone()[0]
        if distinct_topics >= 3 and award_if_not_earned(student_id, "all_subtopics"):
            newly.append("all_subtopics")

    return newly


def get_all(student_id: str) -> list[dict]:
    """Return all achievement definitions with earned status for a student."""
    with get_conn() as conn:
        earned = {
            r[0]: r[1] for r in conn.execute(
                "SELECT achievement_id, unlocked_at FROM achievements WHERE student_id=?",
                (student_id,),
            ).fetchall()
        }
    return [
        {"id": aid, **meta, "earned": aid in earned, "unlocked_at": earned.get(aid)}
        for aid, meta in ACHIEVEMENTS.items()
    ]


def _streak_from_dates(iso_dates: list[str]) -> int:
    """Compute consecutive-day streak from a list of ISO date strings."""
    if not iso_dates:
        return 0
    unique = sorted({date.fromisoformat(d) for d in iso_dates}, reverse=True)
    today = date.today()
    if unique[0] not in (today, today - timedelta(days=1)):
        return 0
    streak = 1
    for i in range(1, len(unique)):
        if unique[i - 1] - unique[i] == timedelta(days=1):
            streak += 1
        else:
            break
    return streak

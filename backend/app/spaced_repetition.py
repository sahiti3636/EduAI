"""SM-2 spaced repetition scheduling.

Seeded from diagnostic bucket: A→quality 5, B→quality 3, C→quality 1.
Updates the next_review date per student per subtopic after each bucket
assignment or override. The algorithm is the standard Anki/SM-2 variant.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.db import get_conn, now

_BUCKET_QUALITY: dict[str, int] = {"A": 5, "B": 3, "C": 1}


def _sm2(interval: int, ease: float, reps: int, quality: int) -> tuple[int, float, int]:
    """Standard SM-2 update. Returns (new_interval_days, new_ease, new_repetitions)."""
    if quality >= 3:
        if reps == 0:
            new_interval = 1
        elif reps == 1:
            new_interval = 6
        else:
            new_interval = round(interval * ease)
        new_ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        new_ease = max(1.3, round(new_ease, 4))
        new_reps = reps + 1
    else:
        new_interval = 1
        new_ease = ease
        new_reps = 0
    return new_interval, new_ease, new_reps


def update_schedule(student_id: str, subtopic: str, bucket: str) -> None:
    """Upsert the SM-2 review schedule after a bucket assignment or override."""
    quality = _BUCKET_QUALITY.get(bucket, 3)

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT interval_days, ease_factor, repetitions FROM spaced_repetition "
            "WHERE student_id=? AND subtopic=?",
            (student_id, subtopic),
        ).fetchone()

        if existing:
            interval = existing["interval_days"]
            ease = existing["ease_factor"]
            reps = existing["repetitions"]
        else:
            interval, ease, reps = 1, 2.5, 0

        new_interval, new_ease, new_reps = _sm2(interval, ease, reps, quality)
        next_review = (date.today() + timedelta(days=new_interval)).isoformat()
        ts = now()

        conn.execute(
            "INSERT INTO spaced_repetition "
            "(student_id, subtopic, next_review, interval_days, ease_factor, repetitions, last_reviewed) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(student_id, subtopic) DO UPDATE SET "
            "next_review=excluded.next_review, interval_days=excluded.interval_days, "
            "ease_factor=excluded.ease_factor, repetitions=excluded.repetitions, "
            "last_reviewed=excluded.last_reviewed",
            (student_id, subtopic, next_review, new_interval, new_ease, new_reps, ts),
        )

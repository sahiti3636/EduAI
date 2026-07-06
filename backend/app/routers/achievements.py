"""Student achievement endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app import achievements as achv

router = APIRouter(tags=["achievements"])


@router.get("/students/{student_id}/achievements")
def list_achievements(student_id: str) -> list[dict]:
    return achv.get_all(student_id)


@router.post("/students/{student_id}/achievements/check")
def trigger_check(student_id: str) -> dict:
    newly = achv.check_and_award(student_id)
    return {
        "newly_awarded": newly,
        "details": [{"id": a, **achv.ACHIEVEMENTS[a]} for a in newly],
    }

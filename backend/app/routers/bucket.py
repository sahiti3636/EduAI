from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.config import get_subtopic
from app.db import get_conn, now
from app.schemas import BucketResponse, OverrideBucketRequest

router = APIRouter(prefix="/students/{student_id}/buckets", tags=["buckets"])


@router.get("/{subtopic}", response_model=BucketResponse)
def get_bucket(student_id: str, subtopic: str) -> BucketResponse:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM buckets WHERE student_id=? AND subtopic=?",
            (student_id, subtopic),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No bucket yet — run the diagnostic first")
    return BucketResponse(**dict(row))


@router.post("/{subtopic}/override", response_model=BucketResponse)
def override_bucket(student_id: str, subtopic: str, req: OverrideBucketRequest) -> BucketResponse:
    """Allow override of a student's bucket by a teacher (or student) per
    CLAUDE.md §5, to handle rater misclassification."""
    try:
        get_subtopic(subtopic)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    source = "teacher_override" if req.by == "teacher" else "student_override"
    updated_at = now()
    rationale = f"Manually overridden by {req.by}."
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO buckets (student_id, subtopic, bucket, rationale, source, per_item_json, updated_at) "
            "VALUES (?, ?, ?, ?, ?, NULL, ?) "
            "ON CONFLICT(student_id, subtopic) DO UPDATE SET "
            "bucket=excluded.bucket, rationale=excluded.rationale, source=excluded.source, "
            "updated_at=excluded.updated_at",
            (student_id, subtopic, req.bucket, rationale, source, updated_at),
        )
        row = conn.execute(
            "SELECT * FROM buckets WHERE student_id=? AND subtopic=?",
            (student_id, subtopic),
        ).fetchone()
    return BucketResponse(**dict(row))

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db import get_conn, new_id, now, rows_to_list
from app.schemas import BucketResponse, CreateStudentRequest, StudentResponse

router = APIRouter(prefix="/students", tags=["students"])


@router.post("", response_model=StudentResponse)
def create_student(req: CreateStudentRequest) -> StudentResponse:
    student_id = new_id()
    created_at = now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO students (id, label, created_at) VALUES (?, ?, ?)",
            (student_id, req.label, created_at),
        )
    return StudentResponse(id=student_id, label=req.label, created_at=created_at)


@router.get("/{student_id}", response_model=StudentResponse)
def get_student(student_id: str) -> StudentResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return StudentResponse(**dict(row))


@router.get("/{student_id}/buckets", response_model=list[BucketResponse])
def list_buckets(student_id: str) -> list[BucketResponse]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM buckets WHERE student_id=?", (student_id,)).fetchall()
    return [
        BucketResponse(
            student_id=r["student_id"],
            subtopic=r["subtopic"],
            bucket=r["bucket"],
            rationale=r["rationale"],
            source=r["source"],
            updated_at=r["updated_at"],
        )
        for r in rows_to_list(rows)
    ]

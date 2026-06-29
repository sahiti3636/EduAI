from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from app.config import get_subtopic
from app.db import get_conn, now
from app.rater import RaterOutputError, rate_subtopic
from app.schemas import (
    DiagnosticItemPublic,
    DiagnosticSubtopicResponse,
    PerItemResult,
    SubmitDiagnosticRequest,
    SubmitDiagnosticResponse,
)

router = APIRouter(prefix="/diagnostic", tags=["diagnostic"])


@router.get("/{subtopic}", response_model=DiagnosticSubtopicResponse)
def get_diagnostic(subtopic: str) -> DiagnosticSubtopicResponse:
    try:
        sub = get_subtopic(subtopic)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    # NOTE: rubric is intentionally withheld from the public response — only
    # id/type/prompt are shown to the student.
    items = [DiagnosticItemPublic(id=i["id"], type=i["type"], prompt=i["prompt"]) for i in sub["items"]]
    return DiagnosticSubtopicResponse(subtopic=subtopic, label=sub["label"], items=items)


@router.post("/{subtopic}/submit", response_model=SubmitDiagnosticResponse)
def submit_diagnostic(subtopic: str, req: SubmitDiagnosticRequest) -> SubmitDiagnosticResponse:
    try:
        get_subtopic(subtopic)  # validates subtopic exists
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    created_at = now()
    with get_conn() as conn:
        for item_id, text in req.responses.items():
            conn.execute(
                "INSERT INTO diagnostic_responses (student_id, subtopic, item_id, response_text, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (req.student_id, subtopic, item_id, text, created_at),
            )

    try:
        result = rate_subtopic(subtopic, req.responses)
    except RaterOutputError as e:
        raise HTTPException(status_code=502, detail=f"Rater failed: {e}") from e

    ts = now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO buckets (student_id, subtopic, bucket, rationale, source, per_item_json, updated_at) "
            "VALUES (?, ?, ?, ?, 'rater', ?, ?) "
            "ON CONFLICT(student_id, subtopic) DO UPDATE SET "
            "bucket=excluded.bucket, rationale=excluded.rationale, source='rater', "
            "per_item_json=excluded.per_item_json, updated_at=excluded.updated_at",
            (
                req.student_id,
                subtopic,
                result.bucket,
                result.rationale,
                json.dumps(result.per_item),
                ts,
            ),
        )
        for error_type in result.error_patterns:
            conn.execute(
                "INSERT INTO error_patterns (student_id, subtopic, error_type, count, last_seen) "
                "VALUES (?, ?, ?, 1, ?) "
                "ON CONFLICT(student_id, subtopic, error_type) DO UPDATE SET "
                "count = count + 1, last_seen = excluded.last_seen",
                (req.student_id, subtopic, error_type, ts),
            )

    return SubmitDiagnosticResponse(
        subtopic=result.subtopic,
        bucket=result.bucket,
        rationale=result.rationale,
        per_item=[PerItemResult(**e) for e in result.per_item],
        used_fallback_heuristic=result.used_fallback_heuristic,
    )

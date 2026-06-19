"""Pydantic request/response models for the API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateStudentRequest(BaseModel):
    # Minors-first data handling (CLAUDE.md §13): a non-identifying label only
    # (e.g. "Student 7", a nickname, or a teacher-assigned code) — never a
    # real name/email. The frontend should not collect real names.
    label: str = Field(..., min_length=1, max_length=80)


class StudentResponse(BaseModel):
    id: str
    label: str
    created_at: str


class DiagnosticItemPublic(BaseModel):
    id: str
    type: str
    prompt: str


class DiagnosticSubtopicResponse(BaseModel):
    subtopic: str
    label: str
    items: list[DiagnosticItemPublic]


class SubmitDiagnosticRequest(BaseModel):
    student_id: str
    responses: dict[str, str]  # item_id -> free-text response


class PerItemResult(BaseModel):
    item_id: str
    band: str
    note: str


class SubmitDiagnosticResponse(BaseModel):
    subtopic: str
    bucket: Literal["A", "B", "C"]
    rationale: str
    per_item: list[PerItemResult]
    used_fallback_heuristic: bool = False


class BucketResponse(BaseModel):
    student_id: str
    subtopic: str
    bucket: Literal["A", "B", "C"]
    rationale: str | None = None
    source: str
    updated_at: str


class OverrideBucketRequest(BaseModel):
    bucket: Literal["A", "B", "C"]
    by: Literal["teacher", "student"] = "teacher"


class SubSubtopicItem(BaseModel):
    id: str
    label: str
    description: str


class StartSessionRequest(BaseModel):
    student_id: str
    subtopic: str
    problem_statement: str | None = None
    sub_subtopic_id: str | None = None   # CBSE chapter within the subtopic


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)


class TutorTurnResponse(BaseModel):
    session_id: str
    reply: str
    bucket_used: Literal["A", "B", "C"]
    rebucket_suggested: str | None = None
    problem_text: str | None = None   # only populated on session start; None on subsequent turns


class LogMetricRequest(BaseModel):
    student_id: str
    subtopic: str | None = None
    metric_type: str
    value: str

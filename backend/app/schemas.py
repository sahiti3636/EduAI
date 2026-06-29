"""Pydantic request/response models for the API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateStudentRequest(BaseModel):
    # Minors-first data handling (CLAUDE.md §13): a non-identifying label only
    # (e.g. "Student 7", a nickname, or a teacher-assigned code) — never a
    # real name/email. The frontend should not collect real names.
    label: str = Field(..., min_length=1, max_length=80)


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=30, pattern=r'^[a-zA-Z0-9_-]+$')
    password: str = Field(..., min_length=6, max_length=100)


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    student_id: str
    username: str


class TeacherLoginRequest(BaseModel):
    username: str
    password: str


class TeacherLoginResponse(BaseModel):
    token: str


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
    prerequisite_id: str | None = None
    prerequisite_label: str | None = None


class StartSessionRequest(BaseModel):
    student_id: str
    subtopic: str
    problem_statement: str | None = None
    sub_subtopic_id: str | None = None
    mode: str = "socratic"             # "socratic" | "feynman"


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)


class TutorTurnResponse(BaseModel):
    session_id: str
    reply: str
    bucket_used: Literal["A", "B", "C"]
    rebucket_suggested: str | None = None
    problem_text: str | None = None
    mode: str = "socratic"


class SessionNotesResponse(BaseModel):
    student_breakthrough: str | None = None
    struggled_with: str | None = None
    topic_covered: str | None = None


class EndSessionResponse(BaseModel):
    ok: bool = True
    notes: SessionNotesResponse | None = None


class LogMetricRequest(BaseModel):
    student_id: str
    subtopic: str | None = None
    metric_type: str
    value: str
    text_feedback: str | None = None   # optional written qualitative feedback


# ── Quiz ─────────────────────────────────────────────────────────────────────

class GenerateQuizRequest(BaseModel):
    student_id: str
    subtopic: str
    sub_subtopic_id: str
    sub_subtopic_label: str


class QuizQuestionPublic(BaseModel):
    id: str
    type: str                          # "mcq" | "short"
    question: str
    options: list[str] | None = None   # MCQ only; not sent for short-answer


class GenerateQuizResponse(BaseModel):
    quiz_id: str
    chapter: str
    bucket: Literal["A", "B", "C"]
    questions: list[QuizQuestionPublic]


class SubmitQuizRequest(BaseModel):
    quiz_id: str
    student_id: str
    answers: dict[str, str]            # {question_id -> student_answer}


class QuizResultItem(BaseModel):
    question_id: str
    correct: bool
    partial: bool
    feedback: str
    correct_answer: str
    explanation: str


class SubmitQuizResponse(BaseModel):
    attempt_id: str
    score: int
    total: int
    results: list[QuizResultItem]


class RevisionRequest(BaseModel):
    attempt_id: str


class RevisionPoint(BaseModel):
    title: str
    explanation: str


class Flashcard(BaseModel):
    front: str
    back: str


class RevisionResponse(BaseModel):
    summary: str
    weak_areas: list[str]
    revision_points: list[RevisionPoint]
    flashcards: list[Flashcard]

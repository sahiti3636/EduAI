"""Quiz generation, answer evaluation, and revision-sheet generation.

Pipeline:
  generate_quiz()     — Gemini generates bucket-calibrated questions (JSON mode)
  evaluate_answers()  — MCQ: local letter-match; short answer: Gemini evaluator
  generate_revision() — Gemini generates revision sheet + flashcards from wrong answers
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.config import get_settings
from app.gemini_client import LLMClient, get_llm_client

# ──────────────────────────────────────────────────────────────────────────────
# Prompts
# ──────────────────────────────────────────────────────────────────────────────

_QUIZ_GEN_SYSTEM = (
    "You are an expert CBSE Class 10 mathematics question-setter. "
    "Output only valid JSON — no markdown fences, no explanation outside the JSON."
)

_QUIZ_GEN_USER = """\
Generate a 5-question quiz on "{chapter}" for a CBSE Class 10 student.

DIFFICULTY — bucket {bucket}:
  A (strong): deep conceptual, proof-based, non-routine application
  B (moderate): standard multi-step CBSE board-level application
  C (needs support): direct recall, single-step, formula application

REQUIRED MIX: exactly 3 MCQ questions (3 options each, one clearly correct) and \
2 short-answer questions (require a worked answer or brief explanation).

Return ONLY this JSON structure (no extra keys, no markdown):
{{
  "chapter": "{chapter}",
  "bucket": "{bucket}",
  "questions": [
    {{
      "id": "q1",
      "type": "mcq",
      "question": "<question text>",
      "options": ["A) ...", "B) ...", "C) ..."],
      "correct_option": "A",
      "explanation": "<why the correct option is right>"
    }},
    {{
      "id": "q2",
      "type": "short",
      "question": "<question text>",
      "sample_answer": "<expected answer with key steps>",
      "explanation": "<full step-by-step solution>"
    }}
  ]
}}"""

_EVAL_SYSTEM = (
    "You are a fair CBSE Class 10 math evaluator. "
    "Output only valid JSON — no markdown fences."
)

_EVAL_USER = """\
Question: {question}
Expected answer: {sample_answer}
Student's answer: {student_answer}

Is the student's answer correct? Award partial credit if the method is right \
but there is a minor arithmetic slip.
Return ONLY: {{"correct": true/false, "partial": true/false, \
"feedback": "<one concise sentence>"}}"""

_REVISION_SYSTEM = (
    "You are a CBSE Class 10 math revision specialist. "
    "Output only valid JSON — no markdown fences."
)

_REVISION_USER = """\
A CBSE Class 10 student (bucket {bucket}) just completed a quiz on "{chapter}".
Score: {score}/{total}

Questions they got wrong:
{wrong_details}

Generate a targeted revision sheet. Return ONLY this JSON:
{{
  "summary": "<2 sentences: what the student needs to focus on>",
  "weak_areas": ["<concept>", "<concept>"],
  "revision_points": [
    {{"title": "<concept>", "explanation": "<2-3 clear sentences with an example>"}}
  ],
  "flashcards": [
    {{"front": "<question or term>", "back": "<answer or definition>"}}
  ]
}}
Include 3-5 revision_points and 6-8 flashcards, all targeted at the specific gaps shown above."""


# ──────────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class QuizQuestion:
    id: str
    type: str                          # "mcq" | "short"
    question: str
    options: list[str] | None          # MCQ only
    correct_option: str | None         # MCQ only (letter, e.g. "A")
    sample_answer: str | None          # short only
    explanation: str


@dataclass
class QuizResult:
    question_id: str
    correct: bool
    partial: bool
    feedback: str
    student_answer: str
    correct_answer: str
    explanation: str


@dataclass
class RevisionSheet:
    summary: str
    weak_areas: list[str]
    revision_points: list[dict]        # [{title, explanation}]
    flashcards: list[dict]             # [{front, back}]


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _strip_fences(text: str) -> str:
    text = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
    return m.group(1) if m else text


def _temperature() -> float:
    return get_settings()["llm"].get("rater_temperature", 0.3)


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def generate_quiz(
    chapter_label: str,
    bucket: str,
    *,
    llm: LLMClient | None = None,
) -> list[QuizQuestion]:
    llm = llm or get_llm_client()
    raw = llm.generate(
        system_prompt=_QUIZ_GEN_SYSTEM,
        history=[{"role": "user", "text": _QUIZ_GEN_USER.format(chapter=chapter_label, bucket=bucket)}],
        temperature=_temperature(),
        json_mode=True,
    )
    data = json.loads(_strip_fences(raw))
    return [
        QuizQuestion(
            id=q["id"],
            type=q["type"],
            question=q["question"],
            options=q.get("options"),
            correct_option=q.get("correct_option"),
            sample_answer=q.get("sample_answer"),
            explanation=q.get("explanation", ""),
        )
        for q in data.get("questions", [])
    ]


def evaluate_answers(
    questions: list[QuizQuestion],
    student_answers: dict[str, str],
    *,
    llm: LLMClient | None = None,
) -> list[QuizResult]:
    llm = llm or get_llm_client()
    results: list[QuizResult] = []

    for q in questions:
        student_ans = student_answers.get(q.id, "").strip()

        if q.type == "mcq":
            s_letter = student_ans.strip().upper()[:1]
            c_letter = (q.correct_option or "").strip().upper()[:1]
            correct = bool(s_letter and s_letter == c_letter)
            results.append(QuizResult(
                question_id=q.id,
                correct=correct,
                partial=False,
                feedback="Correct!" if correct else f"The correct option is {q.correct_option}.",
                student_answer=student_ans,
                correct_answer=q.correct_option or "",
                explanation=q.explanation,
            ))

        else:
            if not student_ans:
                results.append(QuizResult(
                    question_id=q.id,
                    correct=False,
                    partial=False,
                    feedback="No answer provided.",
                    student_answer="",
                    correct_answer=q.sample_answer or "",
                    explanation=q.explanation,
                ))
                continue

            prompt = _EVAL_USER.format(
                question=q.question,
                sample_answer=q.sample_answer or "",
                student_answer=student_ans,
            )
            raw = llm.generate(
                system_prompt=_EVAL_SYSTEM,
                history=[{"role": "user", "text": prompt}],
                temperature=0.1,
                json_mode=True,
            )
            try:
                ev = json.loads(_strip_fences(raw))
                results.append(QuizResult(
                    question_id=q.id,
                    correct=bool(ev.get("correct")),
                    partial=bool(ev.get("partial")),
                    feedback=ev.get("feedback", ""),
                    student_answer=student_ans,
                    correct_answer=q.sample_answer or "",
                    explanation=q.explanation,
                ))
            except (json.JSONDecodeError, KeyError):
                results.append(QuizResult(
                    question_id=q.id,
                    correct=False,
                    partial=False,
                    feedback="Could not auto-evaluate — review with your teacher.",
                    student_answer=student_ans,
                    correct_answer=q.sample_answer or "",
                    explanation=q.explanation,
                ))

    return results


def generate_revision(
    chapter_label: str,
    bucket: str,
    questions: list[QuizQuestion],
    results: list[QuizResult],
    *,
    llm: LLMClient | None = None,
) -> RevisionSheet:
    llm = llm or get_llm_client()
    q_map = {q.id: q for q in questions}
    wrong = [r for r in results if not r.correct]

    if wrong:
        wrong_details = "\n\n".join(
            f"Q: {q_map[r.question_id].question}\n"
            f"Correct answer: {r.correct_answer}\n"
            f"Student answered: {r.student_answer or '(no answer)'}"
            for r in wrong
            if r.question_id in q_map
        )
    else:
        wrong_details = "(All answers were correct — generate a consolidation review.)"

    score = sum(1 for r in results if r.correct)
    raw = llm.generate(
        system_prompt=_REVISION_SYSTEM,
        history=[{"role": "user", "text": _REVISION_USER.format(
            chapter=chapter_label,
            bucket=bucket,
            score=score,
            total=len(results),
            wrong_details=wrong_details,
        )}],
        temperature=_temperature(),
        json_mode=True,
    )
    data = json.loads(_strip_fences(raw))
    return RevisionSheet(
        summary=data.get("summary", ""),
        weak_areas=data.get("weak_areas", []),
        revision_points=data.get("revision_points", []),
        flashcards=data.get("flashcards", []),
    )

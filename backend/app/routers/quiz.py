"""Quiz endpoints: generate questions, submit answers, get revision sheet + flashcard decks."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app import quiz as quiz_logic
from app.db import get_conn, new_id, now
from app.gemini_client import MissingAPIKeyError
from app.schemas import (
    Flashcard,
    GenerateQuizRequest,
    GenerateQuizResponse,
    QuizQuestionPublic,
    QuizResultItem,
    RevisionPoint,
    RevisionRequest,
    RevisionResponse,
    SubmitQuizRequest,
    SubmitQuizResponse,
)

router = APIRouter(prefix="/quiz", tags=["quiz"])


@router.post("/generate", response_model=GenerateQuizResponse)
def generate_quiz(req: GenerateQuizRequest) -> GenerateQuizResponse:
    """Generate a bucket-calibrated 5-question quiz for a CBSE chapter."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT bucket FROM buckets WHERE student_id=? AND subtopic=?",
            (req.student_id, req.subtopic),
        ).fetchone()
    if not row:
        raise HTTPException(
            status_code=400,
            detail="No bucket found — complete the diagnostic for this subject first.",
        )
    bucket: str = row["bucket"]

    try:
        questions = quiz_logic.generate_quiz(req.sub_subtopic_label, bucket)
    except MissingAPIKeyError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {e}") from e

    quiz_id = new_id()
    questions_json = json.dumps([
        {
            "id": q.id,
            "type": q.type,
            "question": q.question,
            "options": q.options,
            "correct_option": q.correct_option,
            "sample_answer": q.sample_answer,
            "explanation": q.explanation,
        }
        for q in questions
    ])
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO quizzes "
            "(id, student_id, subtopic, sub_subtopic_id, sub_subtopic_label, bucket, questions_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (quiz_id, req.student_id, req.subtopic, req.sub_subtopic_id,
             req.sub_subtopic_label, bucket, questions_json, now()),
        )

    return GenerateQuizResponse(
        quiz_id=quiz_id,
        chapter=req.sub_subtopic_label,
        bucket=bucket,
        questions=[
            QuizQuestionPublic(id=q.id, type=q.type, question=q.question, options=q.options)
            for q in questions
        ],
    )


@router.post("/submit", response_model=SubmitQuizResponse)
def submit_quiz(req: SubmitQuizRequest) -> SubmitQuizResponse:
    """Evaluate student answers and store the attempt. Answers are only revealed here."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT questions_json, bucket FROM quizzes WHERE id=? AND student_id=?",
            (req.quiz_id, req.student_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    questions = [
        quiz_logic.QuizQuestion(
            id=q["id"],
            type=q["type"],
            question=q["question"],
            options=q.get("options"),
            correct_option=q.get("correct_option"),
            sample_answer=q.get("sample_answer"),
            explanation=q.get("explanation", ""),
        )
        for q in json.loads(row["questions_json"])
    ]

    try:
        results = quiz_logic.evaluate_answers(questions, req.answers)
    except MissingAPIKeyError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    score = sum(1 for r in results if r.correct)
    attempt_id = new_id()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO quiz_attempts "
            "(id, quiz_id, student_id, answers_json, results_json, score, total, submitted_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                attempt_id,
                req.quiz_id,
                req.student_id,
                json.dumps(req.answers),
                json.dumps([
                    {
                        "question_id": r.question_id,
                        "correct": r.correct,
                        "partial": r.partial,
                        "feedback": r.feedback,
                        "student_answer": r.student_answer,
                        "correct_answer": r.correct_answer,
                        "explanation": r.explanation,
                    }
                    for r in results
                ]),
                score,
                len(results),
                now(),
            ),
        ),
    
    from app.db import award_xp
    award_xp(req.student_id, "quiz_completion", 30)

    return SubmitQuizResponse(
        attempt_id=attempt_id,
        score=score,
        total=len(results),
        results=[
            QuizResultItem(
                question_id=r.question_id,
                correct=r.correct,
                partial=r.partial,
                feedback=r.feedback,
                correct_answer=r.correct_answer,
                explanation=r.explanation,
            )
            for r in results
        ],
    )


@router.post("/revision", response_model=RevisionResponse)
def get_revision(req: RevisionRequest) -> RevisionResponse:
    """Generate a personalised revision sheet + flashcards from a quiz attempt."""
    with get_conn() as conn:
        attempt = conn.execute(
            "SELECT qa.results_json, qa.student_id, qa.score, qa.total, "
            "       q.questions_json, q.sub_subtopic_label, q.bucket "
            "FROM quiz_attempts qa "
            "JOIN quizzes q ON qa.quiz_id = q.id "
            "WHERE qa.id=?",
            (req.attempt_id,),
        ).fetchone()
    if not attempt:
        raise HTTPException(status_code=404, detail="Quiz attempt not found.")

    questions = [
        quiz_logic.QuizQuestion(
            id=q["id"],
            type=q["type"],
            question=q["question"],
            options=q.get("options"),
            correct_option=q.get("correct_option"),
            sample_answer=q.get("sample_answer"),
            explanation=q.get("explanation", ""),
        )
        for q in json.loads(attempt["questions_json"])
    ]
    results = [
        quiz_logic.QuizResult(
            question_id=r["question_id"],
            correct=r["correct"],
            partial=r["partial"],
            feedback=r["feedback"],
            student_answer=r["student_answer"],
            correct_answer=r["correct_answer"],
            explanation=r["explanation"],
        )
        for r in json.loads(attempt["results_json"])
    ]

    try:
        sheet = quiz_logic.generate_revision(
            attempt["sub_subtopic_label"],
            attempt["bucket"],
            questions,
            results,
        )
    except MissingAPIKeyError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e

    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO revision_sheets (id, attempt_id, student_id, content_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                new_id(),
                req.attempt_id,
                attempt["student_id"],
                json.dumps({
                    "summary": sheet.summary,
                    "weak_areas": sheet.weak_areas,
                    "revision_points": sheet.revision_points,
                    "flashcards": sheet.flashcards,
                }),
                now(),
            ),
        )
        # Auto-schedule flashcard deck for spaced repetition (review due tomorrow)
        if sheet.flashcards:
            conn.execute(
                "INSERT INTO flashcard_decks "
                "(id, student_id, attempt_id, sub_subtopic_label, cards_json, next_review, interval_days, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                (
                    new_id(),
                    attempt["student_id"],
                    req.attempt_id,
                    attempt["sub_subtopic_label"],
                    json.dumps(sheet.flashcards),
                    tomorrow,
                    now(),
                ),
            )

    return RevisionResponse(
        summary=sheet.summary,
        weak_areas=sheet.weak_areas,
        revision_points=[RevisionPoint(**rp) for rp in sheet.revision_points],
        flashcards=[Flashcard(**fc) for fc in sheet.flashcards],
    )


@router.get("/flashcards/due")
def get_due_flashcards(student_id: str) -> list[dict]:
    """Return flashcard decks due for review today or earlier."""
    today = datetime.now(timezone.utc).date().isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, sub_subtopic_label, cards_json, next_review, interval_days "
            "FROM flashcard_decks WHERE student_id=? AND next_review<=? ORDER BY next_review",
            (student_id, today),
        ).fetchall()
    return [
        {
            "deck_id": r["id"],
            "label": r["sub_subtopic_label"],
            "cards": json.loads(r["cards_json"]),
            "next_review": r["next_review"],
            "interval_days": r["interval_days"],
        }
        for r in rows
    ]


@router.post("/flashcards/{deck_id}/reviewed")
def mark_deck_reviewed(deck_id: str, rating: str = "got_it") -> dict:
    """Update the spaced-repetition schedule. rating: 'got_it' | 'still_tricky'."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT interval_days, student_id FROM flashcard_decks WHERE id=?", (deck_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Deck not found.")
        interval = row["interval_days"]
        new_interval = max(1, interval * 2) if rating == "got_it" else 1
        next_review = (
            datetime.now(timezone.utc) + timedelta(days=new_interval)
        ).date().isoformat()
        conn.execute(
            "UPDATE flashcard_decks SET interval_days=?, next_review=? WHERE id=?",
            (new_interval, next_review, deck_id),
        )
        
    from app.db import award_xp
    award_xp(row["student_id"], "flashcard_review", 15)
    
    return {"next_review": next_review, "interval_days": new_interval}

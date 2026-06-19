from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import tutor as tutor_logic
from app.config import get_sub_subtopics
from app.gemini_client import MissingAPIKeyError
from app.schemas import SendMessageRequest, StartSessionRequest, SubSubtopicItem, TutorTurnResponse

router = APIRouter(prefix="/tutor", tags=["tutor"])


@router.get("/subtopics/{subtopic}/chapters", response_model=list[SubSubtopicItem])
def list_chapters(subtopic: str) -> list[SubSubtopicItem]:
    """Return the CBSE chapters (sub-subtopics) available for a given subtopic."""
    try:
        items = get_sub_subtopics(subtopic)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return [SubSubtopicItem(**ss) for ss in items]


@router.post("/sessions", response_model=TutorTurnResponse)
def start_session(req: StartSessionRequest) -> TutorTurnResponse:
    try:
        turn = tutor_logic.start_session(
            req.student_id,
            req.subtopic,
            problem_statement=req.problem_statement,
            sub_subtopic_id=req.sub_subtopic_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except MissingAPIKeyError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return TutorTurnResponse(
        session_id=turn.session_id,
        reply=turn.reply_text,
        bucket_used=turn.bucket_used,
        rebucket_suggested=turn.rebucket_suggested,
        problem_text=turn.problem_text,
    )


@router.post("/sessions/{session_id}/messages", response_model=TutorTurnResponse)
def send_message(session_id: str, req: SendMessageRequest) -> TutorTurnResponse:
    try:
        turn = tutor_logic.send_message(session_id, req.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except MissingAPIKeyError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return TutorTurnResponse(
        session_id=turn.session_id,
        reply=turn.reply_text,
        bucket_used=turn.bucket_used,
        rebucket_suggested=turn.rebucket_suggested,
    )


@router.post("/sessions/{session_id}/end")
def end_session(session_id: str) -> dict:
    tutor_logic.end_session(session_id)
    return {"ok": True}

"""Study Pair Mode — real-time collaborative tutoring via WebSocket.

Two students share a room identified by a 6-char code.
The AI tutor sees both students' messages and guides them together.
"""
from __future__ import annotations

import asyncio
import random
import string
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import get_subtopic
from app.db import get_conn, now
from app.gemini_client import get_llm_client
from app.prompts import GUARDRAIL

router = APIRouter(tags=["pair"])

_executor = ThreadPoolExecutor(max_workers=4)


# ── Room code generation ─────────────────────────────────────

def _make_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _unique_code() -> str:
    for _ in range(10):
        code = _make_code()
        with get_conn() as conn:
            if not conn.execute("SELECT 1 FROM pair_rooms WHERE id=?", (code,)).fetchone():
                return code
    raise RuntimeError("Could not generate unique room code.")


# ── Pair tutor prompt ────────────────────────────────────────

_PAIR_SYSTEM = (
    GUARDRAIL
    + """

ADDITIONAL CONTEXT — COLLABORATIVE PAIR:
Two students (HOST and GUEST) are working on this problem together.
- Address students by their role (HOST / GUEST) when responding.
- Encourage them to build on each other's ideas.
- When one student makes progress, prompt the other to verify or extend it.
- If they both get stuck, give the smallest hint to whoever seems most confused.

PROBLEM FOR THIS SESSION:
{problem}
"""
)


# ── In-memory WebSocket manager ──────────────────────────────

class _PairManager:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, WebSocket]] = {}  # room_id → {student_id: ws}

    async def connect(self, room_id: str, student_id: str, ws: WebSocket) -> None:
        await ws.accept()
        if room_id not in self._rooms:
            self._rooms[room_id] = {}
        self._rooms[room_id][student_id] = ws

    def disconnect(self, room_id: str, student_id: str) -> None:
        room = self._rooms.get(room_id, {})
        room.pop(student_id, None)
        if not room:
            self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: str, msg: dict) -> None:
        for ws in list(self._rooms.get(room_id, {}).values()):
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    async def send_to(self, room_id: str, student_id: str, msg: dict) -> None:
        ws = self._rooms.get(room_id, {}).get(student_id)
        if ws:
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    def size(self, room_id: str) -> int:
        return len(self._rooms.get(room_id, {}))


_manager = _PairManager()


# ── Gemini async helper ──────────────────────────────────────

async def _gemini_async(system_prompt: str, history: list[dict]) -> str:
    llm = get_llm_client()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        lambda: llm.generate(system_prompt=system_prompt, history=history, temperature=0.6),
    )


# ── Room history helper ──────────────────────────────────────

def _room_history(room_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, label, content FROM pair_messages "
            "WHERE room_id=? ORDER BY id ASC",
            (room_id,),
        ).fetchall()
    history = []
    for r in rows:
        if r["role"] == "tutor":
            history.append({"role": "model", "text": r["content"]})
        else:
            history.append({
                "role": "user",
                "text": f"[{r['role'].upper()} — {r['label']}]: {r['content']}",
            })
    return history


# ── REST endpoints ───────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    host_student_id: str
    subtopic: str


@router.post("/pair/rooms")
def create_room(req: CreateRoomRequest) -> dict:
    try:
        get_subtopic(req.subtopic)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    with get_conn() as conn:
        student = conn.execute(
            "SELECT label FROM students WHERE id=?", (req.host_student_id,)
        ).fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found.")
        host_label = student["label"]

        # Decide problem: use today's daily challenge if available, else generate default
        from datetime import date
        today = date.today().isoformat()
        daily = conn.execute(
            "SELECT problem_text FROM daily_challenges WHERE date=? AND subtopic=?",
            (today, req.subtopic),
        ).fetchone()

    if daily:
        problem_text = daily["problem_text"]
    else:
        from app.tutor import pick_default_problem
        problem_text = pick_default_problem(req.subtopic, "B")

    code = _unique_code()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pair_rooms (id, host_student_id, host_label, subtopic, problem_text, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (code, req.host_student_id, host_label, req.subtopic, problem_text, now()),
        )

    return {"room_id": code, "host_label": host_label, "subtopic": req.subtopic, "problem_text": problem_text}


class JoinRoomRequest(BaseModel):
    student_id: str


@router.post("/pair/rooms/{room_id}/join")
def join_room(room_id: str, req: JoinRoomRequest) -> dict:
    with get_conn() as conn:
        room = conn.execute("SELECT * FROM pair_rooms WHERE id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room not found. Check the code.")
        if room["ended_at"]:
            raise HTTPException(status_code=410, detail="This session has already ended.")
        if room["guest_student_id"] and room["guest_student_id"] != req.student_id:
            raise HTTPException(status_code=409, detail="Room already has a guest.")
        if room["host_student_id"] == req.student_id:
            # Host re-joining — not an error
            return dict(room)

        student = conn.execute("SELECT label FROM students WHERE id=?", (req.student_id,)).fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found.")
        guest_label = student["label"]

        conn.execute(
            "UPDATE pair_rooms SET guest_student_id=?, guest_label=? WHERE id=?",
            (req.student_id, guest_label, room_id),
        )
        row = conn.execute("SELECT * FROM pair_rooms WHERE id=?", (room_id,)).fetchone()
    try:
        from app.achievements import check_and_award
        check_and_award(req.student_id)
        check_and_award(room["host_student_id"])
    except Exception:
        pass
        
    from app.db import award_xp
    award_xp(req.student_id, "pair_session", 60)
    award_xp(room["host_student_id"], "pair_session", 60)
    
    return dict(row)


@router.get("/pair/rooms/{room_id}")
def get_room(room_id: str) -> dict:
    with get_conn() as conn:
        room = conn.execute("SELECT * FROM pair_rooms WHERE id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room not found.")
        msgs = conn.execute(
            "SELECT role, label, content, created_at FROM pair_messages "
            "WHERE room_id=? ORDER BY id ASC",
            (room_id,),
        ).fetchall()
    return {**dict(room), "messages": [dict(m) for m in msgs]}


# ── WebSocket endpoint ───────────────────────────────────────

@router.websocket("/ws/pair/{room_id}/{student_id}")
async def pair_websocket(ws: WebSocket, room_id: str, student_id: str) -> None:
    with get_conn() as conn:
        room = conn.execute("SELECT * FROM pair_rooms WHERE id=?", (room_id,)).fetchone()

    if not room or room["ended_at"]:
        await ws.close(code=4004, reason="Room not found or closed.")
        return

    # Determine role
    if room["host_student_id"] == student_id:
        role = "host"
        my_label = room["host_label"]
    elif room["guest_student_id"] == student_id:
        role = "guest"
        my_label = room["guest_label"]
    else:
        await ws.close(code=4003, reason="Not a member of this room.")
        return

    await _manager.connect(room_id, student_id, ws)

    # Send full history to reconnecting client
    try:
        history_rows = get_conn().__enter__().execute(
            "SELECT role, label, content, created_at FROM pair_messages "
            "WHERE room_id=? ORDER BY id ASC",
            (room_id,),
        ).fetchall()
    except Exception:
        history_rows = []

    with get_conn() as conn:
        history_rows = conn.execute(
            "SELECT role, label, content, created_at FROM pair_messages "
            "WHERE room_id=? ORDER BY id ASC",
            (room_id,),
        ).fetchall()

    await ws.send_json({"type": "history", "messages": [dict(r) for r in history_rows]})

    # Notify others in room
    await _manager.broadcast(room_id, {"type": "peer_join", "role": role, "label": my_label})

    system_prompt = _PAIR_SYSTEM.format(problem=room["problem_text"])

    try:
        while True:
            data = await ws.receive_json()
            if data.get("type") == "ping":
                await ws.send_json({"type": "pong"})
                continue

            content: str = str(data.get("content", "")).strip()
            if not content:
                continue

            # Save student message
            ts = now()
            with get_conn() as conn:
                conn.execute(
                    "INSERT INTO pair_messages (room_id, sender_id, role, label, content, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (room_id, student_id, role, my_label, content, ts),
                )

            # Broadcast student message to everyone (including sender for display)
            await _manager.broadcast(room_id, {
                "type": "student_message",
                "role": role,
                "label": my_label,
                "content": content,
                "sender_id": student_id,
            })

            # Get AI response async (non-blocking)
            await _manager.broadcast(room_id, {"type": "tutor_typing"})
            history = _room_history(room_id)
            try:
                reply = await _gemini_async(system_prompt, history)
            except Exception as e:
                reply = "I had trouble connecting. Try again!"

            reply = reply.strip()
            ts2 = now()
            with get_conn() as conn:
                conn.execute(
                    "INSERT INTO pair_messages (room_id, sender_id, role, label, content, created_at) "
                    "VALUES (?, NULL, 'tutor', 'Tutor', ?, ?)",
                    (room_id, reply, ts2),
                )

            await _manager.broadcast(room_id, {"type": "tutor_message", "content": reply})

    except WebSocketDisconnect:
        _manager.disconnect(room_id, student_id)
        await _manager.broadcast(room_id, {"type": "peer_leave", "role": role, "label": my_label})

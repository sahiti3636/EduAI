"""Authentication endpoints.

Student auth: PBKDF2-HMAC-SHA256 passwords, username stored as label.
Teacher auth: credentials from TEACHER_USERNAME / TEACHER_PASSWORD env vars.
Teacher token: stateless HMAC-SHA256 derived from the password — no session DB needed.

Minors-first (CLAUDE.md §13): usernames are pilot codes / nicknames, not real names.
API keys / passwords are never hardcoded — always from env vars.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, Header, HTTPException

from app.db import get_conn, new_id, now
from app.schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    TeacherLoginRequest,
    TeacherLoginResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_PBKDF2_ITERATIONS = 260_000  # NIST SP 800-132 recommendation for PBKDF2-SHA256
_HMAC_MSG = b"mindforge_teacher_v1"


# ── Password helpers ──────────────────────────────────────────────────────────

def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()


def _verify_password(password: str, salt: str, stored_hash: str) -> bool:
    computed = _hash_password(password, salt)
    return secrets.compare_digest(computed, stored_hash)


# ── Teacher token helpers (used here and by teacher router) ───────────────────

def _teacher_secret() -> bytes:
    return os.environ.get("TEACHER_PASSWORD", "").encode()


def make_teacher_token() -> str:
    return hmac.new(_teacher_secret(), _HMAC_MSG, hashlib.sha256).hexdigest()


def verify_teacher_token(token: str) -> bool:
    if not _teacher_secret():
        return False
    return secrets.compare_digest(token, make_teacher_token())


# ── FastAPI dependency for teacher-gated endpoints ────────────────────────────

def require_teacher(x_teacher_token: str | None = Header(default=None)) -> None:
    if not x_teacher_token or not verify_teacher_token(x_teacher_token):
        raise HTTPException(status_code=401, detail="Teacher authentication required.")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest) -> AuthResponse:
    username_lower = req.username.lower()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM students WHERE LOWER(username)=?", (username_lower,)
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail="Username already taken. Please choose another.",
            )

        salt = secrets.token_hex(16)
        pw_hash = _hash_password(req.password, salt)
        student_id = new_id()

        conn.execute(
            "INSERT INTO students (id, label, username, password_hash, salt, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (student_id, req.username, req.username, pw_hash, salt, now()),
        )

    return AuthResponse(student_id=student_id, username=req.username)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest) -> AuthResponse:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash, salt FROM students "
            "WHERE LOWER(username)=?",
            (req.username.lower(),),
        ).fetchone()

    # Constant-time: always run verify even on miss to prevent timing oracle
    dummy_hash = "0" * 64
    dummy_salt = "0" * 32
    stored_hash = row["password_hash"] if row else dummy_hash
    salt        = row["salt"]          if row else dummy_salt

    if not _verify_password(req.password, salt, stored_hash) or not row:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    return AuthResponse(student_id=row["id"], username=row["username"])


@router.post("/teacher/login", response_model=TeacherLoginResponse)
def teacher_login(req: TeacherLoginRequest) -> TeacherLoginResponse:
    expected_username = os.environ.get("TEACHER_USERNAME", "admin")
    teacher_password  = os.environ.get("TEACHER_PASSWORD", "")

    if not teacher_password:
        raise HTTPException(
            status_code=503,
            detail="Teacher auth not configured on this server. Set the TEACHER_PASSWORD environment variable.",
        )

    username_ok = secrets.compare_digest(req.username.lower(), expected_username.lower())
    password_ok = secrets.compare_digest(req.password, teacher_password)

    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Invalid teacher credentials.")

    return TeacherLoginResponse(token=make_teacher_token())

"""FastAPI app entrypoint.

Run with:
    cd backend && uvicorn app.main:app --reload --port 8001

The frontend (../frontend/) is served as static files from the same process,
so forwarding a single port is enough to share the full app.
"""
from __future__ import annotations

import pathlib

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routers import achievements, auth, bucket, daily, diagnostic, feedback, leaderboard, metrics, ocr, pair, progress, quiz, report, students, teacher, tutor

_FRONTEND_DIR = pathlib.Path(__file__).parent.parent.parent / "frontend"

app = FastAPI(
    title="EduAI — Adaptive Socratic Math Tutor",
    description="Diagnostic -> Rater -> Bucket -> Tutor pipeline (CLAUDE.md).",
    version="0.1.0",
)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache-control for versioned static assets — safe because all JS/CSS files use
# ?v=N query params, so a version bump busts the cache automatically.
_STATIC_EXTS = {".js", ".css", ".woff", ".woff2", ".ttf", ".png", ".svg", ".ico"}

@app.middleware("http")
async def add_cache_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    path = request.url.path
    if any(path.endswith(ext) for ext in _STATIC_EXTS):
        has_version = "v=" in (request.url.query or "")
        # versioned files → cache 7 days; unversioned → revalidate each visit
        directive = "public, max-age=604800, immutable" if has_version else "no-cache"
        response.headers["Cache-Control"] = directive
    elif path.endswith(".html") or path == "/":
        # HTML must never be stale — always revalidate so JS/CSS changes land immediately
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(students.router)
app.include_router(diagnostic.router)
app.include_router(bucket.router)
app.include_router(tutor.router)
app.include_router(metrics.router)
app.include_router(quiz.router)
app.include_router(progress.router)
app.include_router(report.router)
app.include_router(daily.router)
app.include_router(leaderboard.router)
app.include_router(pair.router)
app.include_router(teacher.router)
app.include_router(ocr.router)
app.include_router(feedback.router)
app.include_router(achievements.router)

# Serve the frontend — must come LAST so API routes above take precedence.
if _FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="static")

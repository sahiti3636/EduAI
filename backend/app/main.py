"""FastAPI app entrypoint.

Run with:
    cd backend && uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routers import bucket, diagnostic, metrics, students, tutor

app = FastAPI(
    title="EduAI — Adaptive Socratic Math Tutor",
    description="Diagnostic -> Rater -> Bucket -> Tutor pipeline (CLAUDE.md).",
    version="0.1.0",
)

# Dev-friendly CORS so the lightweight static frontend (served separately,
# e.g. via `python -m http.server`) can call this API from another port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(students.router)
app.include_router(diagnostic.router)
app.include_router(bucket.router)
app.include_router(tutor.router)
app.include_router(metrics.router)

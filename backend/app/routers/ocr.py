"""OCR endpoint — extract math problem text from an uploaded image.

Uses Gemini's multimodal vision via the same SDK already in use.
No student PII is sent — only the raw image bytes and a fixed prompt.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile

from app.gemini_client import get_llm_client

router = APIRouter(prefix="/ocr", tags=["ocr"])

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB

_EXTRACT_PROMPT = """\
This image contains a math problem (handwritten, printed, or photographed from a textbook).

Extract the complete problem text as accurately as possible:
- Preserve all mathematical expressions, numbers, and operators exactly.
- Use LaTeX notation for math: wrap inline expressions in $...$ and display equations in $$...$$.
- If the image contains working or multiple parts, extract all of them in reading order.
- Output ONLY the extracted problem text — no commentary, no preamble.
- If the image is not a math problem, output exactly: [Not a math problem]
"""


@router.post("/extract")
async def extract_text(file: UploadFile) -> dict:
    if file.content_type not in _ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type '{file.content_type}'. Upload a JPEG, PNG, WebP, GIF, HEIC, or HEIF image.",
        )

    image_bytes = await file.read()
    if len(image_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large. Please upload an image under 10 MB.")

    try:
        client = get_llm_client()
        text = client.generate_with_image(_EXTRACT_PROMPT, image_bytes, file.content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Vision model error: {exc}") from exc

    text = text.strip()
    if text == "[Not a math problem]":
        raise HTTPException(status_code=422, detail="The image does not appear to contain a math problem.")

    return {"text": text}

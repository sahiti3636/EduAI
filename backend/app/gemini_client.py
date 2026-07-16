"""Model-agnostic LLM client wrapper.

CLAUDE.md §4: "Model-agnostic prompt layer: keep system prompts and logic
independent of the provider so the engine could later swap to another model."

Everything outside this file talks to `LLMClient`, never to the google-genai
SDK directly. To swap providers later, write a new class with the same
interface and change `get_llm_client()`.

The API key is read from an environment variable (name configurable in
config/settings.yaml, default GEMINI_API_KEY) — never hardcoded, per CLAUDE.md
§13.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Protocol

from app.config import get_settings


class LLMClient(Protocol):
    def generate(
        self,
        system_prompt: str,
        history: list[dict[str, str]],
        *,
        temperature: float = 0.5,
        json_mode: bool = False,
    ) -> str:
        """Run one model call.

        history: list of {"role": "user"|"model", "text": "..."} turns, in
        order. The system_prompt is supplied separately (not as a history
        turn) so providers that support a dedicated system-instruction slot
        can use it natively.

        Returns the model's reply text.
        """
        ...

    def embed(self, text: str) -> list[float]:
        """Embed a piece of text into a vector."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of strings into vectors."""
        ...

    def generate_with_image(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str,
    ) -> str:
        """Run a single multimodal call with one image and a text prompt."""
        ...


class MissingAPIKeyError(RuntimeError):
    pass


@dataclass
class GeminiClient:
    model: str
    api_key_env_var: str = "GEMINI_API_KEY"
    _client: object | None = field(default=None, repr=False)

    def _ensure_client(self):
        if self._client is not None:
            return self._client
        api_key = os.environ.get(self.api_key_env_var)
        if not api_key:
            raise MissingAPIKeyError(
                f"Environment variable {self.api_key_env_var} is not set. "
                "Get a key from https://aistudio.google.com/apikey and "
                f"`export {self.api_key_env_var}=...` before running."
            )
        from google import genai  # imported lazily so the app can boot without it

        self._client = genai.Client(api_key=api_key)
        return self._client

    def generate(
        self,
        system_prompt: str,
        history: list[dict[str, str]],
        *,
        temperature: float = 0.5,
        json_mode: bool = False,
    ) -> str:
        from google.genai import types

        client = self._ensure_client()

        contents = [
            types.Content(
                role=turn["role"],
                parts=[types.Part.from_text(text=turn["text"])],
            )
            for turn in history
        ]

        config_kwargs: dict = dict(
            system_instruction=system_prompt,
            temperature=temperature,
        )
        if json_mode:
            config_kwargs["response_mime_type"] = "application/json"

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(**config_kwargs),
                )
                return response.text or ""
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise

    def generate_with_image(
        self,
        prompt: str,
        image_bytes: bytes,
        mime_type: str,
    ) -> str:
        from google.genai import types

        client = self._ensure_client()
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    types.Part.from_text(text=prompt),
                ],
            )
        ]
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(temperature=0.1),
                )
                return response.text or ""
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise

    def embed(self, text: str) -> list[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        client = self._ensure_client()
        import time
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = client.models.embed_content(
                    model="gemini-embedding-2",
                    contents=texts,
                )
                return [emb.values for emb in response.embeddings]
            except Exception as e:
                if "429" in str(e) and attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise


_client_singleton: LLMClient | None = None


def get_llm_client() -> LLMClient:
    global _client_singleton
    if _client_singleton is None:
        settings = get_settings()["llm"]
        _client_singleton = GeminiClient(
            model=settings["model"],
            api_key_env_var=settings.get("api_key_env_var", "GEMINI_API_KEY"),
        )
    return _client_singleton


def reset_client_singleton() -> None:
    """For tests: force re-reading config / re-creating the client."""
    global _client_singleton
    _client_singleton = None

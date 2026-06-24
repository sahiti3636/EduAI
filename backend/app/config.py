"""Loads config/curriculum.yaml and config/settings.yaml.

Keeping subtopics/items/rubrics/model-name/thresholds in YAML (not code) so the
curriculum or model can be swapped without touching the application logic, per
CLAUDE.md §6/§13 ("config-driven").
"""
from __future__ import annotations

import functools
import os
from pathlib import Path
from typing import Any

import yaml

# repo layout: <repo_root>/backend/app/config.py -> repo_root/config/*.yaml
REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


def _load_yaml(name: str) -> dict[str, Any]:
    path = CONFIG_DIR / name
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


@functools.lru_cache(maxsize=1)
def get_curriculum() -> dict[str, Any]:
    return _load_yaml("curriculum.yaml")


@functools.lru_cache(maxsize=1)
def get_settings() -> dict[str, Any]:
    return _load_yaml("settings.yaml")


def get_subtopic(subtopic: str) -> dict[str, Any]:
    curriculum = get_curriculum()
    subtopics = curriculum.get("subtopics", {})
    if subtopic not in subtopics:
        raise KeyError(f"Unknown subtopic: {subtopic!r}. Known: {list(subtopics)}")
    return subtopics[subtopic]


def get_sub_subtopics(subtopic: str) -> list[dict[str, Any]]:
    return get_subtopic(subtopic).get("sub_subtopics", [])


def get_sub_subtopic(subtopic: str, sub_id: str) -> dict[str, Any]:
    for ss in get_sub_subtopics(subtopic):
        if ss["id"] == sub_id:
            return ss
    raise KeyError(f"Unknown sub_subtopic {sub_id!r} for subtopic {subtopic!r}")


def get_items(subtopic: str) -> list[dict[str, Any]]:
    return get_subtopic(subtopic).get("items", [])


def get_item(subtopic: str, item_id: str) -> dict[str, Any]:
    for item in get_items(subtopic):
        if item["id"] == item_id:
            return item
    raise KeyError(f"Unknown item_id {item_id!r} for subtopic {subtopic!r}")


def db_path() -> Path:
    # DB_PATH env var overrides the YAML setting — used in production (Railway volume).
    env = os.environ.get("DB_PATH")
    if env:
        p = Path(env)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    rel = get_settings()["database"]["path"]
    return REPO_ROOT / rel


def clear_caches() -> None:
    """Used by tests / hot-reload to force a re-read of the YAML files."""
    get_curriculum.cache_clear()
    get_settings.cache_clear()

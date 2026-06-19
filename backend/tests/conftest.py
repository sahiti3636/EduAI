import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app import config as app_config  # noqa: E402
from app import db as app_db  # noqa: E402


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """Point the DB layer at a throwaway sqlite file for this test only."""
    db_file = tmp_path / "test.db"
    monkeypatch.setattr(app_db, "db_path", lambda: db_file)
    app_db.init_db()
    yield db_file


@pytest.fixture(autouse=True)
def _clear_config_cache():
    app_config.clear_caches()
    yield
    app_config.clear_caches()

import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def configured_path(variable: str, default: Path) -> Path:
    value = os.getenv(variable)
    path = Path(value) if value else default
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return path.resolve()


DATABASE_PATH = os.getenv("SUPABASE_DB_URL", "").strip() or configured_path("SUPPORTPILOT_DB", BACKEND_DIR / "data" / "supportpilot.db")
CATEGORY_MODEL_PATH = configured_path(
    "CATEGORY_MODEL_PATH", BACKEND_DIR.parent / "models" / "category_classifier.pkl"
)
PRIORITY_MODEL_PATH = configured_path(
    "PRIORITY_MODEL_PATH",
    BACKEND_DIR.parent / "severityANDpriority" / "priority_model.joblib",
)
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
    ).split(",")
    if origin.strip()
]
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
SESSION_COOKIE_NAME = "supportpilot_session"
SESSION_TTL_SECONDS = 60 * 60 * 12
SESSION_COOKIE_SECURE = APP_ENV == "production"

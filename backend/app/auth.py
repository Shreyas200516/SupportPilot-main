from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, Request, status

from . import database
from .config import DATABASE_PATH, SESSION_TTL_SECONDS


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


DUMMY_PASSWORD_HASH = hash_password("SupportPilot unknown account timing value")


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        expected = bytes.fromhex(digest_hex)
        candidate = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError):
        return False


def _session_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: int) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=SESSION_TTL_SECONDS)
    database.create_session(DATABASE_PATH, _session_digest(token), user_id, expires_at.isoformat())
    return token, expires_at


def revoke_session(token: str | None) -> None:
    if token:
        database.delete_session(DATABASE_PATH, _session_digest(token))


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": int(user["user_id"]),
        "email": user["email"],
        "display_name": user["display_name"],
        "role": user["role"],
        "workspace_scope": user["workspace_scope"],
    }


def get_current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get("supportpilot_session")
    user = database.get_session_user(DATABASE_PATH, _session_digest(token)) if token else None
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please sign in.")
    return user


def require_role(*roles: str):
    def dependency(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission for this action.")
        return user

    return dependency


def ensure_workspace_access(user: dict[str, Any], workspace: str) -> None:
    if user["role"] == "admin":
        return
    if user["role"] == "support_agent":
        scope = user.get("workspace_scope")
        if scope in (None, "all") or scope == workspace:
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this workspace.")

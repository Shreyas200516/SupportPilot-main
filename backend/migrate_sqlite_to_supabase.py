"""Copy local users, tickets, and knowledge articles into configured Supabase PostgreSQL."""

import os
import sqlite3
from pathlib import Path

from app import database
from app.config import BACKEND_DIR


_source_path = Path(os.getenv("SUPPORTPILOT_DB", BACKEND_DIR / "data" / "supportpilot.db"))
SOURCE = _source_path if _source_path.is_absolute() else (BACKEND_DIR / _source_path).resolve()
TARGET_URL = os.getenv("SUPABASE_DB_URL", "").strip()
TABLE_COLUMNS = {
    "users": ("user_id", "email", "display_name", "password_hash", "role", "workspace_scope", "is_active", "created_at"),
    "tickets": (
        "ticket_id", "requester_user_id", "subject", "body", "requester_email", "workspace", "category",
        "ticket_type", "ticket_type_confidence", "ticket_type_probabilities", "assigned_team", "category_source",
        "priority", "severity", "priority_raw_prediction", "priority_confidence", "priority_source",
        "priority_probabilities", "severity_score", "severity_confidence", "severity_reasoning", "sla",
        "alignment_notes", "business_impact", "affected_users", "service_criticality", "created_at",
        "review_status", "review_reason",
    ),
    "knowledge_articles": (
        "article_id", "title", "summary", "content", "category", "workspace", "keywords", "is_published",
        "owner", "created_at", "updated_at",
    ),
}


def main() -> None:
    if not TARGET_URL.startswith(("postgres://", "postgresql://")):
        raise SystemExit("Set SUPABASE_DB_URL in backend/.env to a PostgreSQL connection string first.")
    if not SOURCE.is_file():
        raise SystemExit(f"Local database not found: {SOURCE}")

    database.initialize(TARGET_URL)
    counts: dict[str, int] = {}
    user_id_map: dict[int, int] = {}
    with sqlite3.connect(SOURCE) as local:
        local.row_factory = sqlite3.Row
        with database.database_connection(TARGET_URL) as remote:
            for table, columns in TABLE_COLUMNS.items():
                local_columns = {row["name"] for row in local.execute(f"PRAGMA table_info({table})")}
                if not local_columns:
                    counts[table] = 0
                    continue
                usable = [column for column in columns if column in local_columns]
                records = local.execute(f"SELECT {', '.join(usable)} FROM {table}").fetchall()
                if table == "users":
                    names = ", ".join(usable)
                    placeholders = ", ".join("?" for _ in usable)
                    sql = f"INSERT INTO users ({names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                    for record in records:
                        remote.execute(sql, tuple(record[column] for column in usable))
                        mapped = remote.execute(
                            "SELECT user_id FROM users WHERE lower(email) = lower(?)",
                            (record["email"],),
                        ).fetchone()
                        if mapped:
                            user_id_map[int(record["user_id"])] = int(mapped["user_id"])
                    counts[table] = len(records)
                    continue
                names = ", ".join(usable)
                placeholders = ", ".join("?" for _ in usable)
                sql = f"INSERT INTO {table} ({names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                for record in records:
                    values = {column: record[column] for column in usable}
                    if table == "tickets" and values.get("requester_user_id") is not None:
                        values["requester_user_id"] = user_id_map.get(int(values["requester_user_id"]))
                    remote.execute(sql, tuple(values[column] for column in usable))
                counts[table] = len(records)
            remote.execute(
                "SELECT setval(pg_get_serial_sequence('public.users', 'user_id'), "
                "GREATEST(COALESCE((SELECT MAX(user_id) FROM public.users), 1), 1), "
                "EXISTS(SELECT 1 FROM public.users))"
            )
    print("Migration complete. Auth sessions were intentionally not copied; users must sign in again.")
    for table, count in counts.items():
        print(f"{table}: {count} source rows processed")


if __name__ == "__main__":
    main()

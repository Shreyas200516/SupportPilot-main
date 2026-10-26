import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from .schemas import KnowledgeArticleCreate, TicketCreate


def _is_postgres(database_path: Path | str) -> bool:
    return isinstance(database_path, str) and database_path.startswith(("postgres://", "postgresql://"))


class _PostgresConnection:
    def __init__(self, url: str):
        import psycopg
        from psycopg.rows import dict_row
        self.raw = psycopg.connect(url, row_factory=dict_row, connect_timeout=10, prepare_threshold=None)

    def execute(self, sql: str, params=None):
        if isinstance(params, dict):
            sql = re.sub(r"(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)", r"%(\1)s", sql)
        else:
            sql = sql.replace("?", "%s")
        return self.raw.execute(sql, params)

    def __enter__(self):
        self.raw.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        return self.raw.__exit__(exc_type, exc, tb)

    def close(self):
        self.raw.close()


def connect(database_path: Path | str):
    if _is_postgres(database_path):
        return _PostgresConnection(database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection(database_path: Path):
    connection = connect(database_path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize(database_path: Path | str) -> None:
    if _is_postgres(database_path):
        with database_connection(database_path) as connection:
            statements = [
                """CREATE TABLE IF NOT EXISTS users (user_id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('requester','support_agent','admin')), workspace_scope TEXT, is_active SMALLINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL)""",
                """CREATE TABLE IF NOT EXISTS tickets (ticket_id TEXT PRIMARY KEY, requester_user_id BIGINT REFERENCES users(user_id), subject TEXT NOT NULL, body TEXT NOT NULL, requester_email TEXT, workspace TEXT NOT NULL DEFAULT 'IT Service Desk', category TEXT NOT NULL, ticket_type TEXT NOT NULL DEFAULT 'Incident', ticket_type_confidence DOUBLE PRECISION NOT NULL DEFAULT 0, ticket_type_probabilities TEXT NOT NULL DEFAULT '{}', assigned_team TEXT NOT NULL DEFAULT 'Service Desk L1', category_source TEXT NOT NULL DEFAULT 'ml_model', priority TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('Critical','High','Medium','Low')), priority_raw_prediction TEXT NOT NULL DEFAULT '', priority_confidence DOUBLE PRECISION NOT NULL DEFAULT 0, priority_source TEXT NOT NULL DEFAULT '', priority_probabilities TEXT NOT NULL DEFAULT '{}', severity_score INTEGER NOT NULL DEFAULT 0, severity_confidence DOUBLE PRECISION NOT NULL DEFAULT 0, severity_reasoning TEXT NOT NULL DEFAULT '', sla TEXT NOT NULL DEFAULT '{}', alignment_notes TEXT NOT NULL DEFAULT '', business_impact TEXT NOT NULL, affected_users INTEGER NOT NULL CHECK(affected_users >= 1), service_criticality TEXT NOT NULL, created_at TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'accepted', review_reason TEXT NOT NULL DEFAULT '')""",
                """CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)""",
                """CREATE TABLE IF NOT EXISTS knowledge_articles (article_id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL, category TEXT NOT NULL, workspace TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]', is_published SMALLINT NOT NULL DEFAULT 0, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
            ]
            for statement in statements:
                connection.execute(statement)
            # The app talks to PostgreSQL through its private server connection only.
            # Do not expose account, session, or ticket tables through the Supabase Data API.
            connection.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'accepted'")
            connection.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS review_reason TEXT NOT NULL DEFAULT ''")
            for table in ("users", "tickets", "auth_sessions", "knowledge_articles"):
                connection.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                connection.execute(f"REVOKE ALL ON TABLE {table} FROM anon, authenticated")
        return
    with database_connection(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tickets (
                ticket_id TEXT PRIMARY KEY,
                requester_user_id INTEGER,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                requester_email TEXT,
                workspace TEXT NOT NULL DEFAULT 'IT Service Desk',
                category TEXT NOT NULL,
                ticket_type TEXT NOT NULL DEFAULT 'Incident',
                ticket_type_confidence REAL NOT NULL DEFAULT 0,
                ticket_type_probabilities TEXT NOT NULL DEFAULT '{}',
                assigned_team TEXT NOT NULL DEFAULT 'Service Desk L1',
                category_source TEXT NOT NULL DEFAULT 'keyword_mock',
                priority TEXT NOT NULL,
                severity TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
                priority_raw_prediction TEXT NOT NULL DEFAULT '',
                priority_confidence REAL NOT NULL DEFAULT 0,
                priority_source TEXT NOT NULL DEFAULT '',
                priority_probabilities TEXT NOT NULL DEFAULT '{}',
                severity_score INTEGER NOT NULL DEFAULT 0,
                severity_confidence REAL NOT NULL DEFAULT 0,
                severity_reasoning TEXT NOT NULL DEFAULT '',
                sla TEXT NOT NULL DEFAULT '{}',
                alignment_notes TEXT NOT NULL DEFAULT '',
                business_impact TEXT NOT NULL,
                affected_users INTEGER NOT NULL CHECK (affected_users >= 1),
                service_criticality TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('requester', 'support_agent', 'admin')),
                workspace_scope TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_articles (
                article_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL,
                workspace TEXT NOT NULL,
                keywords TEXT NOT NULL DEFAULT '[]',
                is_published INTEGER NOT NULL DEFAULT 0,
                owner TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        existing_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(tickets)")
        }
        migrations = {
            "requester_user_id": "INTEGER REFERENCES users(user_id)",
            "workspace": "TEXT NOT NULL DEFAULT 'IT Service Desk'",
            "ticket_type": "TEXT NOT NULL DEFAULT 'Incident'",
            "ticket_type_confidence": "REAL NOT NULL DEFAULT 0",
            "ticket_type_probabilities": "TEXT NOT NULL DEFAULT '{}'",
            "assigned_team": "TEXT NOT NULL DEFAULT 'Service Desk L1'",
            "category_source": "TEXT NOT NULL DEFAULT 'keyword_mock'",
            "priority_raw_prediction": "TEXT NOT NULL DEFAULT ''",
            "priority_confidence": "REAL NOT NULL DEFAULT 0",
            "priority_source": "TEXT NOT NULL DEFAULT ''",
            "priority_probabilities": "TEXT NOT NULL DEFAULT '{}'",
            "severity_score": "INTEGER NOT NULL DEFAULT 0",
            "severity_confidence": "REAL NOT NULL DEFAULT 0",
            "severity_reasoning": "TEXT NOT NULL DEFAULT ''",
            "sla": "TEXT NOT NULL DEFAULT '{}'",
            "alignment_notes": "TEXT NOT NULL DEFAULT ''",
            "review_status": "TEXT NOT NULL DEFAULT 'accepted'",
            "review_reason": "TEXT NOT NULL DEFAULT ''",
        }
        for column, definition in migrations.items():
            if column not in existing_columns:
                connection.execute(f"ALTER TABLE tickets ADD COLUMN {column} {definition}")


def insert_ticket(
    database_path: Path,
    ticket_id: UUID,
    ticket: TicketCreate,
    ticket_type: str,
    ticket_type_confidence: float,
    ticket_type_probabilities: dict[str, float],
    assigned_team: str,
    analysis: dict[str, Any],
    requester_user_id: int | None,
    review_status: str = "accepted",
    review_reason: str = "",
) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    priority = analysis["priority"]
    severity = analysis["severity"]
    severity_inputs = severity["inputs"]
    values = {
        "ticket_id": str(ticket_id),
        "requester_user_id": requester_user_id,
        "subject": ticket.subject,
        "body": ticket.body,
        "requester_email": str(ticket.requester_email) if ticket.requester_email else None,
        "workspace": ticket.workspace.value,
        "category": ticket.category,
        "ticket_type": ticket_type,
        "ticket_type_confidence": ticket_type_confidence,
        "ticket_type_probabilities": json.dumps(ticket_type_probabilities),
        "assigned_team": assigned_team,
        "category_source": "user_selected_service_area",
        "priority": str(priority["predicted_priority"]).lower(),
        "severity": severity["level"],
        "priority_raw_prediction": str(priority["raw_model_prediction"]).lower(),
        "priority_confidence": float(priority["confidence"]),
        "priority_source": priority["model_source"],
        "priority_probabilities": json.dumps(priority["class_probabilities"]),
        "severity_score": int(severity["score"]),
        "severity_confidence": float(severity["confidence"]),
        "severity_reasoning": severity["reasoning"],
        "sla": json.dumps(analysis["sla"]),
        "alignment_notes": analysis["alignment_notes"],
        "business_impact": severity_inputs["business_impact"],
        "affected_users": int(severity_inputs["affected_users"]),
        "service_criticality": severity_inputs["service_criticality"],
        "created_at": created_at,
        "review_status": review_status,
        "review_reason": review_reason,
    }
    with database_connection(database_path) as connection:
        connection.execute(
            """
            INSERT INTO tickets (
                ticket_id, requester_user_id, subject, body, requester_email, workspace, category, ticket_type,
                ticket_type_confidence, ticket_type_probabilities, assigned_team,
                category_source, priority, severity,
                priority_raw_prediction, priority_confidence, priority_source,
                priority_probabilities, severity_score, severity_confidence,
                severity_reasoning, sla, alignment_notes,
                business_impact, affected_users, service_criticality, created_at, review_status, review_reason
            ) VALUES (
                :ticket_id, :requester_user_id, :subject, :body, :requester_email, :workspace, :category, :ticket_type,
                :ticket_type_confidence, :ticket_type_probabilities, :assigned_team,
                :category_source, :priority, :severity,
                :priority_raw_prediction, :priority_confidence, :priority_source,
                :priority_probabilities, :severity_score, :severity_confidence,
                :severity_reasoning, :sla, :alignment_notes,
                :business_impact, :affected_users, :service_criticality, :created_at, :review_status, :review_reason
            )
            """,
            values,
        )
    return {
        **values,
        "priority_probabilities": json.loads(values["priority_probabilities"]),
        "ticket_type_probabilities": json.loads(values["ticket_type_probabilities"]),
        "sla": json.loads(values["sla"]),
    }


def get_ticket(database_path: Path, ticket_id: UUID) -> dict[str, Any] | None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            "SELECT * FROM tickets WHERE ticket_id = ?", (str(ticket_id),)
        ).fetchone()
    return _decode_record(row) if row else None


def list_tickets(
    database_path: Path,
    limit: int,
    offset: int,
    workspace: str | None = None,
    requester_user_id: int | None = None,
) -> list[dict[str, Any]]:
    with database_connection(database_path) as connection:
        if requester_user_id is not None and workspace:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE requester_user_id = ? AND workspace = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (requester_user_id, workspace, limit, offset),
            ).fetchall()
        elif requester_user_id is not None:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE requester_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (requester_user_id, limit, offset),
            ).fetchall()
        elif workspace:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE workspace = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (workspace, limit, offset),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM tickets ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
    return [_decode_record(row) for row in rows]


def get_user_by_email(database_path: Path, email: str) -> dict[str, Any] | None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email.casefold(),)
        ).fetchone()
    return dict(row) if row else None


def get_user(database_path: Path, user_id: int) -> dict[str, Any] | None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def create_user(
    database_path: Path,
    email: str,
    display_name: str,
    password_hash: str,
    role: str,
    workspace_scope: str | None = None,
) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    with database_connection(database_path) as connection:
        cursor = connection.execute(
            "INSERT INTO users (email, display_name, password_hash, role, workspace_scope, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING user_id",
            (email.strip().casefold(), display_name.strip(), password_hash, role, workspace_scope, created_at),
        )
        user_id = int(cursor.fetchone()["user_id"])
    user = get_user(database_path, user_id)
    assert user is not None
    return user


def list_users(database_path: Path) -> list[dict[str, Any]]:
    with database_connection(database_path) as connection:
        rows = connection.execute(
            "SELECT user_id, email, display_name, role, workspace_scope, is_active, created_at FROM users ORDER BY created_at"
        ).fetchall()
    return [dict(row) for row in rows]


def create_knowledge_article(
    database_path: Path, article: KnowledgeArticleCreate, owner: str
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    article_id = f"KB-{uuid4().hex[:10].upper()}"
    values = {
        "article_id": article_id,
        "title": article.title,
        "summary": article.summary,
        "content": article.content,
        "category": article.category,
        "workspace": article.workspace.value,
        "keywords": json.dumps(sorted({word.strip() for word in article.keywords if word.strip()})),
        "is_published": int(article.is_published),
        "owner": owner,
        "created_at": now,
        "updated_at": now,
    }
    with database_connection(database_path) as connection:
        connection.execute(
            """INSERT INTO knowledge_articles
            (article_id, title, summary, content, category, workspace, keywords,
             is_published, owner, created_at, updated_at)
            VALUES (:article_id, :title, :summary, :content, :category, :workspace,
             :keywords, :is_published, :owner, :created_at, :updated_at)""",
            values,
        )
    return _decode_article(values)


def get_knowledge_article(database_path: Path, article_id: str) -> dict[str, Any] | None:
    with database_connection(database_path) as connection:
        row = connection.execute(
            "SELECT * FROM knowledge_articles WHERE article_id = ?", (article_id,)
        ).fetchone()
    return _decode_article(dict(row)) if row else None


def list_knowledge_articles(
    database_path: Path,
    workspace: str | None = None,
    category: str | None = None,
    query: str | None = None,
    published_only: bool = True,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if published_only:
        clauses.append("is_published = 1")
    if workspace:
        clauses.append("workspace = ?")
        params.append(workspace)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if query:
        clauses.append("(title LIKE ? OR summary LIKE ? OR content LIKE ? OR keywords LIKE ?)")
        pattern = f"%{query.strip()}%"
        params.extend([pattern] * 4)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with database_connection(database_path) as connection:
        rows = connection.execute(
            f"SELECT * FROM knowledge_articles {where} ORDER BY updated_at DESC", params
        ).fetchall()
    return [_decode_article(dict(row)) for row in rows]


def update_knowledge_article(
    database_path: Path, article_id: str, changes: dict[str, Any]
) -> dict[str, Any] | None:
    current = get_knowledge_article(database_path, article_id)
    if current is None:
        return None
    updated = {**current, **changes, "updated_at": datetime.now(timezone.utc).isoformat()}
    if "workspace" in changes and hasattr(changes["workspace"], "value"):
        updated["workspace"] = changes["workspace"].value
    keyword_values = changes.get("keywords", current["keywords"])
    updated["keywords"] = json.dumps(
        sorted({word.strip() for word in keyword_values if word.strip()})
    )
    updated["is_published"] = int(updated["is_published"])
    with database_connection(database_path) as connection:
        connection.execute(
            """UPDATE knowledge_articles SET title=:title, summary=:summary, content=:content,
            category=:category, workspace=:workspace, keywords=:keywords,
            is_published=:is_published, updated_at=:updated_at WHERE article_id=:article_id""",
            updated,
        )
    return _decode_article(updated)


def _decode_article(record: dict[str, Any]) -> dict[str, Any]:
    decoded = dict(record)
    decoded["keywords"] = json.loads(decoded["keywords"])
    decoded["is_published"] = bool(decoded["is_published"])
    return decoded


def set_user_active(database_path: Path, user_id: int, is_active: bool) -> bool:
    with database_connection(database_path) as connection:
        cursor = connection.execute(
            "UPDATE users SET is_active = ? WHERE user_id = ?", (int(is_active), user_id)
        )
        if is_active:
            return cursor.rowcount > 0
        connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        return cursor.rowcount > 0


def create_session(database_path: Path, token_hash: str, user_id: int, expires_at: str) -> None:
    with database_connection(database_path) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token_hash, user_id, expires_at, datetime.now(timezone.utc).isoformat()),
        )


def get_session_user(database_path: Path, token_hash: str) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc).isoformat()
    with database_connection(database_path) as connection:
        row = connection.execute(
            "SELECT users.* FROM auth_sessions JOIN users USING (user_id) WHERE token_hash = ? AND expires_at > ? AND users.is_active = 1",
            (token_hash, now),
        ).fetchone()
        if row is None:
            connection.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now,))
    return dict(row) if row else None


def delete_session(database_path: Path, token_hash: str) -> None:
    with database_connection(database_path) as connection:
        connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))


def _decode_record(row: sqlite3.Row) -> dict[str, Any]:
    record = dict(row)
    record["priority_probabilities"] = json.loads(record["priority_probabilities"])
    record["ticket_type_probabilities"] = json.loads(record["ticket_type_probabilities"])
    record["sla"] = json.loads(record["sla"])
    return record


def update_ticket_review(database_path: Path, ticket_id: UUID, review_status: str, review_reason: str) -> bool:
    with database_connection(database_path) as connection:
        cursor = connection.execute(
            "UPDATE tickets SET review_status = ?, review_reason = ? WHERE ticket_id = ?",
            (review_status, review_reason, str(ticket_id)),
        )
        return cursor.rowcount > 0

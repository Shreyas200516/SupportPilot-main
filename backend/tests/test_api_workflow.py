from http.cookies import SimpleCookie
from pathlib import Path
from uuid import UUID

import pytest
from fastapi import HTTPException, Request, Response
from pydantic import ValidationError

from app import auth, database, main
from app.schemas import (
    AdminUserCreate, KnowledgeArticleCreate, KnowledgeArticleUpdate, LoginRequest,
    RegisterRequest, TicketCreate, UserActiveUpdate,
)

PASSWORD = "SupportPilot demo passphrase 2026!"


def request_with(origin: str | None = None, token: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if origin:
        headers.append((b"origin", origin.encode()))
    if token:
        headers.append((b"cookie", f"supportpilot_session={token}".encode()))
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": "POST", "scheme": "http", "path": "/",
        "raw_path": b"/", "query_string": b"", "headers": headers,
        "client": ("testclient", 123), "server": ("testserver", 80),
    }
    return Request(scope)


@pytest.fixture
def database_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "tickets.sqlite3"
    monkeypatch.setattr(main, "DATABASE_PATH", path)
    monkeypatch.setattr(auth, "DATABASE_PATH", path)
    database.initialize(path)
    password_hash = auth.hash_password(PASSWORD)
    database.create_user(path, "requester@example.com", "Shreyas", password_hash, "requester")
    database.create_user(
        path, "it-agent@example.com", "Srinidhi", password_hash, "support_agent", "IT Service Desk"
    )
    database.create_user(
        path, "facilities-agent@example.com", "Priyanka", password_hash, "support_agent", "Facilities Helpdesk"
    )
    database.create_user(path, "admin@example.com", "Sakshi", password_hash, "admin")
    return path


def user_for(path: Path, email: str) -> dict[str, object]:
    user = database.get_user_by_email(path, email)
    assert user is not None
    return user


def ticket_payload(**overrides: object) -> TicketCreate:
    values: dict[str, object] = {
        "subject": "Company VPN outage",
        "body": "Remote staff cannot connect and the business is blocked.",
        "requester_email": "spoofed@example.com",
        "workspace": "IT Service Desk",
        "category": "VPN",
        "business_impact": "high",
        "affected_users": 120,
        "service_criticality": "tier_2",
    }
    values.update(overrides)
    return TicketCreate.model_validate(values)


def test_health_reports_loaded_team_models(database_path: Path) -> None:
    models = main.health()["models"]
    assert models["ticket_type_model_loaded"] is True
    assert models["priority_model_loaded"] is True


def test_login_me_and_logout_revoke_session(database_path: Path) -> None:
    response = Response()
    signed_in = main.login(LoginRequest(email="requester@example.com", password=PASSWORD), request_with(), response)
    cookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    token = cookie["supportpilot_session"].value
    current = auth.get_current_user(request_with(token=token))
    assert signed_in["role"] == "requester"
    assert auth.public_user(current)["user_id"] == signed_in["user_id"]
    logout_response = Response()
    main.logout(request_with(token=token), logout_response)
    with pytest.raises(HTTPException) as error:
        auth.get_current_user(request_with(token=token))
    assert error.value.status_code == 401
    assert "Max-Age=0" in logout_response.headers["set-cookie"]


def test_public_signup_only_creates_requester(database_path: Path) -> None:
    response = Response()
    user = main.register_requester(
        RegisterRequest(email="new@example.com", display_name="Priyanka", password=PASSWORD),
        request_with(), response,
    )
    assert user["role"] == "requester"
    assert database.get_user_by_email(database_path, "new@example.com")["role"] == "requester"
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate(
            {"email": "bad@example.com", "display_name": "Priyanka", "password": PASSWORD, "role": "admin"}
        )


def test_requester_ticket_processing_and_owner_binding(database_path: Path) -> None:
    requester = user_for(database_path, "requester@example.com")
    ticket = main.create_ticket(ticket_payload(), request_with(), requester)
    UUID(ticket["ticket_id"])
    assert ticket["ticket_type"] in {"Change", "Incident", "Problem", "Request"}
    assert 0 <= ticket["ticket_type_confidence"] <= 1
    assert ticket["priority_source"] == "ml_model"
    assert ticket["assigned_team"] == "Infrastructure"
    assert ticket["requester_email"] == "requester@example.com"
    stored = database.get_ticket(database_path, UUID(ticket["ticket_id"]))
    assert stored["requester_user_id"] == requester["user_id"]
    assert main.read_ticket(UUID(ticket["ticket_id"]), requester) == stored
    assert main.read_tickets(50, 0, None, requester)["items"] == [stored]


def test_requester_cannot_read_another_users_ticket(database_path: Path) -> None:
    first = user_for(database_path, "requester@example.com")
    other = database.create_user(database_path, "other@example.com", "Other", auth.hash_password(PASSWORD), "requester")
    ticket = main.create_ticket(ticket_payload(), request_with(), first)
    ticket_id = UUID(ticket["ticket_id"])
    with pytest.raises(HTTPException) as error:
        main.read_ticket(ticket_id, other)
    assert error.value.status_code == 404
    assert main.read_tickets(50, 0, None, other)["items"] == []


def test_support_agent_workspace_scope_is_enforced(database_path: Path) -> None:
    requester = user_for(database_path, "requester@example.com")
    ticket = main.create_ticket(
        ticket_payload(
            subject="Facilities plumbing leak",
            body="Water is leaking from a pipe in the second-floor corridor.",
            workspace="Facilities Helpdesk", category="Plumbing",
        ),
        request_with(), requester,
    )
    agent = user_for(database_path, "it-agent@example.com")
    assert main.read_tickets(50, 0, None, agent)["items"] == []
    with pytest.raises(HTTPException) as list_error:
        main.read_tickets(50, 0, "Facilities Helpdesk", agent)
    assert list_error.value.status_code == 403
    with pytest.raises(HTTPException) as ticket_error:
        main.read_ticket(UUID(ticket["ticket_id"]), agent)
    assert ticket_error.value.status_code == 403
    with pytest.raises(HTTPException):
        main.create_ticket(ticket_payload(workspace="Facilities Helpdesk", category="Plumbing"), request_with(), agent)


def test_admin_can_manage_accounts_and_deactivation_revokes_session(database_path: Path) -> None:
    admin = user_for(database_path, "admin@example.com")
    new_agent = main.create_account(
        AdminUserCreate(
            email="new-agent@example.com", display_name="Sakshi", password=PASSWORD,
            role="support_agent", workspace_scope="Facilities Helpdesk",
        ),
        request_with(), admin,
    )
    assert new_agent["role"] == "support_agent"
    assert len(main.list_accounts(admin)["items"]) == 5
    token, _ = auth.create_session(int(new_agent["user_id"]))
    assert auth.get_current_user(request_with(token=token))["email"] == "new-agent@example.com"
    main.set_account_active(int(new_agent["user_id"]), UserActiveUpdate(is_active=False), request_with(), admin)
    with pytest.raises(HTTPException):
        auth.get_current_user(request_with(token=token))


def test_support_agent_list_uses_active_scoped_accounts(database_path: Path) -> None:
    it_agent = user_for(database_path, "it-agent@example.com")
    facilities_agent = user_for(database_path, "facilities-agent@example.com")
    requester = user_for(database_path, "requester@example.com")

    scoped = main.list_support_agents(it_agent)
    assert [item["user_id"] for item in scoped["items"]] == [it_agent["user_id"]]
    with pytest.raises(HTTPException) as error:
        main.list_support_agents(requester)
    assert error.value.status_code == 403

    admin = user_for(database_path, "admin@example.com")
    all_agents = main.list_support_agents(admin)
    assert {item["user_id"] for item in all_agents["items"]} == {
        it_agent["user_id"], facilities_agent["user_id"]
    }


def test_knowledge_articles_support_scoped_search_and_publish(database_path: Path) -> None:
    admin = user_for(database_path, "admin@example.com")
    requester = user_for(database_path, "requester@example.com")
    it_agent = user_for(database_path, "it-agent@example.com")
    article = main.create_knowledge_article(
        KnowledgeArticleCreate(
            title="Reset the VPN connection", summary="Steps to restore a failed VPN connection.",
            content="Check internet access, restart the VPN application, then sign in again.",
            category="VPN", workspace="IT Service Desk", keywords=["vpn", "remote access"],
            is_published=False,
        ), request_with(), admin,
    )
    assert article["article_id"].startswith("KB-")
    assert main.list_knowledge_articles(None, None, None, it_agent)["items"][0]["is_published"] is False
    assert main.list_knowledge_articles(None, None, None, requester)["items"] == []
    with pytest.raises(HTTPException) as create_error:
        main.create_knowledge_article(
            KnowledgeArticleCreate(
                title="Requester guide title", summary="A long enough summary for a guide.",
                content="This guide has enough content for the backend validator.", category="VPN",
                workspace="IT Service Desk",
            ), request_with(), requester,
        )
    assert create_error.value.status_code == 403
    main.edit_knowledge_article(
        article["article_id"], KnowledgeArticleUpdate(is_published=True), request_with(), admin
    )
    visible = main.list_knowledge_articles("vpn", "VPN", "IT Service Desk", requester)["items"]
    assert len(visible) == 1
    assert visible[0]["article_id"] == article["article_id"]
    with pytest.raises(HTTPException) as scope_error:
        main.list_knowledge_articles(None, None, "Facilities Helpdesk", it_agent)
    assert scope_error.value.status_code == 403


def test_facilities_safety_hazard_escalates_and_routes(database_path: Path) -> None:
    requester = user_for(database_path, "requester@example.com")
    ticket = main.create_ticket(
        ticket_payload(
            subject="Smoke in electrical room", body="Smoke and fire are present near the electrical panel.",
            workspace="Facilities Helpdesk", category="Safety",
        ),
        request_with(), requester,
    )
    assert ticket["priority"] == "critical"
    assert ticket["severity"] == "Critical"
    assert ticket["assigned_team"] == "Facilities · Safety"
    assert ticket["sla"]["response_time"] == "15 mins"


def test_invalid_workspace_category_and_input_are_rejected(database_path: Path) -> None:
    requester = user_for(database_path, "requester@example.com")
    with pytest.raises(HTTPException) as category_error:
        main.create_ticket(ticket_payload(category="Plumbing"), request_with(), requester)
    assert category_error.value.status_code == 422
    with pytest.raises(ValidationError):
        ticket_payload(affected_users=0)


def test_admin_endpoints_require_admin_role(database_path: Path) -> None:
    requester = user_for(database_path, "requester@example.com")
    with pytest.raises(HTTPException) as error:
        auth.require_role("admin")(requester)
    assert error.value.status_code == 403


def test_disallowed_origin_cannot_mutate_session_or_tickets(database_path: Path) -> None:
    main.validate_origin(request_with(origin="http://testserver"))
    with pytest.raises(HTTPException) as login_error:
        main.login(
            LoginRequest(email="requester@example.com", password=PASSWORD),
            request_with(origin="https://attacker.invalid"), Response(),
        )
    assert login_error.value.status_code == 403
    requester = user_for(database_path, "requester@example.com")
    with pytest.raises(HTTPException) as ticket_error:
        main.create_ticket(ticket_payload(), request_with(origin="https://attacker.invalid"), requester)
    assert ticket_error.value.status_code == 403

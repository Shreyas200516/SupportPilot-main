from contextlib import asynccontextmanager
import csv
import hmac
import io
import os
import re
import sqlite3
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import auth, database
from .config import (
    CATEGORY_MODEL_PATH, CORS_ORIGINS, DATABASE_PATH, PRIORITY_MODEL_PATH,
    SESSION_COOKIE_NAME, SESSION_COOKIE_SECURE, SESSION_TTL_SECONDS,
)
from .predictors import PredictorService
from .schemas import (
    AdminUserCreate, AuthUser, LoginRequest, RegisterRequest, TicketCreate,
    KnowledgeArticleCreate, KnowledgeArticleListResponse, KnowledgeArticleUpdate,
    KnowledgeArticleView, SupportAgentListResponse, TicketListResponse, TicketResponse, UserActiveUpdate,
    UserListResponse, UserRole, TicketReviewUpdate,
)


predictors = PredictorService(CATEGORY_MODEL_PATH, PRIORITY_MODEL_PATH)


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize(DATABASE_PATH)
    yield


app = FastAPI(
    title="SupportPilot Ticket API",
    description="Ticket intake, model predictions, severity scoring, and shared Supabase PostgreSQL or local SQLite storage.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "database": "supabase-postgres" if isinstance(DATABASE_PATH, str) and DATABASE_PATH.startswith(("postgres://", "postgresql://")) else "local-sqlite", "models": predictors.status}


def validate_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    api_origin = f"{request.url.scheme}://{request.url.netloc}"
    if origin and origin not in CORS_ORIGINS and origin != api_origin:
        raise HTTPException(status_code=403, detail="Request origin is not allowed.")


def issue_session(response: Response, user: dict[str, object]) -> dict[str, object]:
    token, _ = auth.create_session(int(user["user_id"]))
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )
    return auth.public_user(user)


@app.post("/api/auth/register", response_model=AuthUser, status_code=status.HTTP_201_CREATED)
def register_requester(
    payload: RegisterRequest,
    request: Request,
    response: Response,
) -> dict[str, object]:
    validate_origin(request)
    try:
        user = database.create_user(
            DATABASE_PATH,
            str(payload.email).casefold(),
            payload.display_name,
            auth.hash_password(payload.password),
            "requester",
        )
    except Exception as exc:
        if isinstance(exc, sqlite3.IntegrityError) or getattr(exc, "sqlstate", None) == "23505":
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        raise
    return issue_session(response, user)


@app.post("/api/auth/login", response_model=AuthUser)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
) -> dict[str, object]:
    validate_origin(request)
    user = database.get_user_by_email(DATABASE_PATH, str(payload.email))
    password_hash = user["password_hash"] if user else auth.DUMMY_PASSWORD_HASH
    password_ok = auth.verify_password(payload.password, password_hash)
    if not user or not user["is_active"] or not password_ok:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return issue_session(response, user)


@app.get("/api/auth/me", response_model=AuthUser)
def current_user(user: dict[str, object] = Depends(auth.get_current_user)) -> dict[str, object]:
    return auth.public_user(user)


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> Response:
    validate_origin(request)
    auth.revoke_session(request.cookies.get(SESSION_COOKIE_NAME))
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite="lax",
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.get("/api/admin/users", response_model=UserListResponse)
def list_accounts(
    _: dict[str, object] = Depends(auth.require_role("admin")),
) -> dict[str, object]:
    return {"items": database.list_users(DATABASE_PATH)}


@app.get("/api/support/agents", response_model=SupportAgentListResponse)
def list_support_agents(
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    if current_user["role"] not in {"admin", "support_agent"}:
        raise HTTPException(status_code=403, detail="Only support staff can view agent assignments.")
    scope = current_user.get("workspace_scope")
    agents = [
        user
        for user in database.list_users(DATABASE_PATH)
        if user["role"] == "support_agent"
        and user["is_active"]
        and (
            current_user["role"] == "admin"
            or scope in (None, "all")
            or user["workspace_scope"] in (None, "all", scope)
        )
    ]
    return {
        "items": [
            {
                "user_id": agent["user_id"],
                "display_name": agent["display_name"],
                "workspace_scope": agent["workspace_scope"],
            }
            for agent in agents
        ]
    }


def _can_manage_article(user: dict[str, object], workspace: str) -> bool:
    return user["role"] == "admin" or (
        user["role"] == "support_agent"
        and user.get("workspace_scope") in (None, "all", workspace)
    )


def _validate_article_category(workspace: str, category: str) -> None:
    categories = (
        {"HVAC", "Plumbing", "Electrical", "Cleaning", "Furniture", "Building Access", "Safety", "Other"}
        if workspace == "Facilities Helpdesk"
        else {"Network", "Account & Password", "VPN", "Software", "Hardware", "System"}
    )
    if category not in categories:
        raise HTTPException(status_code=422, detail="Choose a category valid for the article workspace.")


@app.get("/api/knowledge/articles", response_model=KnowledgeArticleListResponse)
def list_knowledge_articles(
    q: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=80),
    workspace: str | None = Query(default=None, max_length=40),
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    if current_user["role"] == "requester":
        published_only = True
    else:
        scope = current_user.get("workspace_scope")
        if workspace and not _can_manage_article(current_user, workspace):
            raise HTTPException(status_code=403, detail="This workspace is outside your support scope.")
        if not workspace and scope not in (None, "all"):
            workspace = str(scope)
        published_only = False
    if workspace and workspace not in {"IT Service Desk", "Facilities Helpdesk"}:
        raise HTTPException(status_code=422, detail="Choose a valid workspace.")
    items = database.list_knowledge_articles(
        DATABASE_PATH, workspace=workspace, category=category, query=q,
        published_only=published_only,
    )
    return {"items": items}


@app.get("/api/knowledge/articles/{article_id}", response_model=KnowledgeArticleView)
def read_knowledge_article(
    article_id: str,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    article = database.get_knowledge_article(DATABASE_PATH, article_id)
    if article is None or (
        current_user["role"] == "requester" and not article["is_published"]
    ):
        raise HTTPException(status_code=404, detail="Knowledge article not found.")
    if current_user["role"] != "requester" and not _can_manage_article(
        current_user, article["workspace"]
    ):
        raise HTTPException(status_code=404, detail="Knowledge article not found.")
    return article


@app.post(
    "/api/knowledge/articles",
    response_model=KnowledgeArticleView,
    status_code=status.HTTP_201_CREATED,
)
def create_knowledge_article(
    payload: KnowledgeArticleCreate,
    request: Request,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    validate_origin(request)
    if not _can_manage_article(current_user, payload.workspace.value):
        raise HTTPException(status_code=403, detail="You cannot manage articles for this workspace.")
    if current_user["role"] == "requester":
        raise HTTPException(status_code=403, detail="Only support staff can manage knowledge articles.")
    _validate_article_category(payload.workspace.value, payload.category)
    return database.create_knowledge_article(
        DATABASE_PATH, payload, str(current_user["display_name"])
    )


@app.patch("/api/knowledge/articles/{article_id}", response_model=KnowledgeArticleView)
def edit_knowledge_article(
    article_id: str,
    payload: KnowledgeArticleUpdate,
    request: Request,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    validate_origin(request)
    article = database.get_knowledge_article(DATABASE_PATH, article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="Knowledge article not found.")
    if not _can_manage_article(current_user, article["workspace"]):
        raise HTTPException(status_code=403, detail="You cannot manage this knowledge article.")
    changes = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }
    next_workspace = changes.get("workspace", article["workspace"])
    if hasattr(next_workspace, "value"):
        next_workspace = next_workspace.value
    if not _can_manage_article(current_user, str(next_workspace)):
        raise HTTPException(status_code=403, detail="You cannot move this article to that workspace.")
    _validate_article_category(str(next_workspace), str(changes.get("category", article["category"])))
    updated = database.update_knowledge_article(DATABASE_PATH, article_id, changes)
    assert updated is not None
    return updated


@app.post("/api/admin/users", response_model=AuthUser, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AdminUserCreate,
    request: Request,
    _: dict[str, object] = Depends(auth.require_role("admin")),
) -> dict[str, object]:
    validate_origin(request)
    role = payload.role.value
    scope = payload.workspace_scope
    if role == "support_agent" and scope not in {"all", "IT Service Desk", "Facilities Helpdesk"}:
        raise HTTPException(status_code=422, detail="Choose a valid workspace scope for this support account.")
    if role != "support_agent" and scope is not None:
        raise HTTPException(status_code=422, detail="Workspace scope applies only to support accounts.")
    try:
        user = database.create_user(
            DATABASE_PATH,
            str(payload.email).casefold(),
            payload.display_name,
            auth.hash_password(payload.password),
            role,
            scope,
        )
    except Exception as exc:
        if isinstance(exc, sqlite3.IntegrityError) or getattr(exc, "sqlstate", None) == "23505":
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        raise
    return auth.public_user(user)


@app.patch("/api/admin/users/{user_id}/active", status_code=status.HTTP_204_NO_CONTENT)
def set_account_active(
    user_id: int,
    payload: UserActiveUpdate,
    request: Request,
    admin: dict[str, object] = Depends(auth.require_role("admin")),
) -> Response:
    validate_origin(request)
    if int(admin["user_id"]) == user_id and not payload.is_active:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
    if not database.set_user_active(DATABASE_PATH, user_id, payload.is_active):
        raise HTTPException(status_code=404, detail="Account not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _spam_review(text: str) -> tuple[str, str]:
    indicators = ("claim your prize", "guaranteed crypto returns", "work from home and earn", "casino bonus", "buy followers")
    found = next((phrase for phrase in indicators if phrase in text.casefold()), None)
    link_count = len(re.findall(r"https?://", text, re.IGNORECASE))
    if found or link_count >= 4:
        reason = f"Needs a human review: suspicious promotional phrase '{found}'." if found else "Needs a human review: message contains several external links."
        return "needs_review", reason
    return "accepted", ""


def _process_ticket(ticket: TicketCreate, requester_user_id: int | None) -> dict[str, object]:
    valid_categories = (
        {"HVAC", "Plumbing", "Electrical", "Cleaning", "Furniture", "Building Access", "Safety", "Other"}
        if ticket.workspace.value == "Facilities Helpdesk"
        else {"Network", "Account & Password", "VPN", "Software", "Hardware", "System"}
    )
    if ticket.category not in valid_categories:
        raise HTTPException(status_code=422, detail=f"Category '{ticket.category}' does not belong to {ticket.workspace.value}.")
    ticket_text = f"{ticket.subject}\n{ticket.body}"
    try:
        ticket_type, type_confidence, type_probabilities = predictors.classify_type(ticket_text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Ticket type model is not ready.") from exc
    analysis = predictors.evaluate_priority_severity(
        ticket_text, ticket.business_impact.value if ticket.business_impact else None,
        ticket.affected_users, ticket.service_criticality.value if ticket.service_criticality else None,
    )
    safety_hazard = ticket.workspace.value == "Facilities Helpdesk" and re.search(
        r"\b(fire|smoke|gas leak|exposed wiring|exposed wire|electric(?:al)? shock|injur(?:y|ies|ed)|(?:ceiling|structural) collapse[sd]?)\b",
        ticket_text, re.IGNORECASE,
    ) is not None
    if safety_hazard:
        analysis["priority"]["predicted_priority"] = "Critical"
        analysis["alignment_notes"] = "Priority elevated to Critical by the Facilities immediate-safety rule."
        severity = analysis["severity"]
        severity["level"] = "Critical"
        severity["score"] = max(80, int(severity["score"]))
        severity["confidence"] = max(0.99, float(severity["confidence"]))
        severity["reasoning"] += " Immediate Facilities safety hazard detected; escalated to Critical."
        analysis["sla"] = {"response_time": "15 mins", "resolution_time": "2 hours", "escalation": "Immediate safety escalation"}
    review_status, review_reason = _spam_review(ticket_text)
    try:
        team = route_team(ticket.workspace.value, "Safety" if safety_hazard else ticket.category, ticket_type)
        return database.insert_ticket(DATABASE_PATH, uuid4(), ticket, ticket_type, type_confidence,
                                      type_probabilities, team, analysis, requester_user_id, review_status, review_reason)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not save the ticket.") from exc


@app.post("/api/tickets", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(
    ticket: TicketCreate,
    request: Request,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    validate_origin(request)
    if current_user["role"] != "requester":
        auth.ensure_workspace_access(current_user, ticket.workspace.value)
    valid_categories = (
        {"HVAC", "Plumbing", "Electrical", "Cleaning", "Furniture", "Building Access", "Safety", "Other"}
        if ticket.workspace.value == "Facilities Helpdesk"
        else {"Network", "Account & Password", "VPN", "Software", "Hardware", "System"}
    )
    if ticket.category not in valid_categories:
        raise HTTPException(
            status_code=422,
            detail=f"Category '{ticket.category}' does not belong to {ticket.workspace.value}.",
        )
    if current_user["role"] == "requester":
        ticket = ticket.model_copy(update={"requester_email": current_user["email"]})
    ticket_text = f"{ticket.subject}\n{ticket.body}"
    try:
        ticket_type, type_confidence, type_probabilities = predictors.classify_type(ticket_text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Ticket type model is not ready.") from exc
    analysis = predictors.evaluate_priority_severity(
        ticket_text,
        ticket.business_impact.value if ticket.business_impact else None,
        ticket.affected_users,
        ticket.service_criticality.value if ticket.service_criticality else None,
    )
    safety_hazard = (
        ticket.workspace.value == "Facilities Helpdesk"
        and re.search(
            r"\b(fire|smoke|gas leak|exposed wiring|exposed wire|electric(?:al)? shock|injur(?:y|ies|ed)|(?:ceiling|structural) collapse[sd]?)\b",
            ticket_text,
            re.IGNORECASE,
        )
        is not None
    )
    if safety_hazard:
        analysis["priority"]["predicted_priority"] = "Critical"
        analysis["alignment_notes"] = "Priority elevated to Critical by the Facilities immediate-safety rule."
        severity = analysis["severity"]
        severity["level"] = "Critical"
        severity["score"] = max(80, int(severity["score"]))
        severity["confidence"] = max(0.99, float(severity["confidence"]))
        severity["reasoning"] += " Immediate Facilities safety hazard detected; escalated to Critical."
        analysis["sla"] = {
            "response_time": "15 mins",
            "resolution_time": "2 hours",
            "escalation": "Immediate PagerDuty On-Call + Incident Commander + VP Alert",
        }
    try:
        route_category = "Safety" if safety_hazard else ticket.category
        team = route_team(ticket.workspace.value, route_category, ticket_type)
        review_status, review_reason = _spam_review(ticket_text)
        return database.insert_ticket(
            DATABASE_PATH, uuid4(), ticket, ticket_type, type_confidence,
            type_probabilities, team, analysis, int(current_user["user_id"]), review_status, review_reason
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not save the ticket.") from exc


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=4, max_length=2000)
    workspace: str
    language: str = Field(default="en", pattern="^(en|hi|kn)$")


@app.post("/api/assistant/diagnose")
def diagnose_ticket(
    payload: TicketCreate,
    user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    if user["role"] != "requester":
        auth.ensure_workspace_access(user, payload.workspace.value)
    text = f"{payload.subject}\n{payload.body}"
    try:
        ticket_type, confidence, probabilities = predictors.classify_type(text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Ticket type model is not ready.") from exc
    analysis = predictors.evaluate_priority_severity(
        text, payload.business_impact.value if payload.business_impact else None,
        payload.affected_users, payload.service_criticality.value if payload.service_criticality else None,
    )
    return {
        "ticket_type": ticket_type, "ticket_type_confidence": confidence,
        "ticket_type_probabilities": probabilities,
        "priority": analysis["priority"], "severity": analysis["severity"],
        "explanation": "Scores come from the trained model probabilities and the configured impact/severity rules. Treat low-confidence results as suggestions and have support staff confirm them.",
    }


@app.post("/api/assistant/ask")
def ask_knowledge_bot(
    payload: AssistantQuestion,
    user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    if payload.workspace not in {"IT Service Desk", "Facilities Helpdesk"}:
        raise HTTPException(status_code=422, detail="Choose a valid workspace.")
    if user["role"] != "requester":
        auth.ensure_workspace_access(user, payload.workspace)
    articles = database.list_knowledge_articles(DATABASE_PATH, workspace=payload.workspace, published_only=True)
    from .translations import translate_text

    search_question = payload.question
    translation_error: str | None = None
    if payload.language != "en":
        try:
            search_question = translate_text(payload.question, "en", payload.language)
        except RuntimeError as exc:
            translation_error = str(exc)
    words = set(re.findall(r"[a-z0-9]{3,}", search_question.casefold()))
    ranked = []
    for article in articles:
        text = " ".join([article["title"], article["summary"], article["content"], " ".join(article["keywords"])]).casefold()
        overlap = words & set(re.findall(r"[a-z0-9]{3,}", text))
        if overlap:
            ranked.append((len(overlap) / max(1, len(words)), article))
    ranked.sort(key=lambda item: item[0], reverse=True)
    sources = [{"article_id": article["article_id"], "title": article["title"], "summary": article["summary"], "content": article["content"], "match": round(score, 2)} for score, article in ranked[:3]]
    answer = "I couldn't find a published guide that clearly matches. Please create a support ticket or ask the service desk." if not sources else "I found these published support guides. Follow their steps and use the links below; if they don't solve the issue, submit a ticket."
    translated = payload.language == "en"
    if payload.language != "en" and translation_error is None:
        try:
            translated_answer = translate_text(answer, payload.language)
            translated_sources = []
            for source in sources:
                translated_sources.append({
                    **source,
                    "title": translate_text(source["title"], payload.language),
                    "summary": translate_text(source["summary"], payload.language),
                    "content": translate_text(source["content"], payload.language),
                })
            answer, sources = translated_answer, translated_sources
            translated = True
        except RuntimeError as exc:
            translation_error = str(exc)
    if translation_error:
        answer = "Multilingual search is unavailable. Showing English results. " + translation_error
    mode = "knowledge_retrieval"
    generation_notice: str | None = None
    if sources and translation_error is None:
        from .rag import generate_grounded_answer

        try:
            generated = generate_grounded_answer(payload.question, sources, payload.language)
            if generated:
                answer = generated
                mode = "rag_generation"
        except RuntimeError as exc:
            generation_notice = str(exc)
    if generation_notice:
        notice = "The grounded answer model is temporarily unavailable; use the linked article sources."
        if payload.language != "en" and translated:
            try:
                notice = translate_text(notice, payload.language)
            except RuntimeError:
                pass
        answer += " " + notice
    return {
        "answer": answer,
        "sources": sources,
        "mode": mode,
        "language": payload.language if translated or payload.language == "en" else "en",
        "translation_available": translated,
    }


@app.post("/api/tickets/import-csv")
async def import_tickets_csv(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Query(default=False),
    user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    validate_origin(request)
    if user["role"] not in {"admin", "support_agent"}:
        raise HTTPException(status_code=403, detail="Only support staff can import tickets.")
    if not file.filename or not file.filename.casefold().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Upload a .csv file.")
    content = await file.read(10_000_001)
    if len(content) > 10_000_000:
        raise HTTPException(status_code=413, detail="CSV must be smaller than 10 MB.")
    try:
        rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
    except (UnicodeDecodeError, csv.Error) as exc:
        raise HTTPException(status_code=422, detail="CSV must be UTF-8 encoded and have a valid header row.") from exc
    if len(rows) > 5000:
        raise HTTPException(status_code=413, detail="Import up to 5,000 tickets per file.")
    imported, errors, seen = [], [], set()
    for row_number, row in enumerate(rows, start=2):
        try:
            model = TicketCreate.model_validate({
                "subject": row.get("subject", ""), "body": row.get("body", row.get("description", "")),
                "requester_email": row.get("requester_email") or None, "workspace": row.get("workspace", "IT Service Desk"),
                "category": row.get("category", ""), "business_impact": row.get("business_impact") or "medium",
                "affected_users": int(row.get("affected_users") or 1), "service_criticality": row.get("service_criticality") or "tier_3",
            })
            auth.ensure_workspace_access(user, model.workspace.value)
            key = (str(model.requester_email or "").casefold(), model.subject.casefold(), model.body.casefold())
            if key in seen:
                raise ValueError("Duplicate of another row in this file.")
            seen.add(key)
            if dry_run:
                imported.append({"row": row_number, "subject": model.subject, "workspace": model.workspace.value, "category": model.category})
            else:
                imported.append(_process_ticket(model, int(user["user_id"])))
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            errors.append({"row": row_number, "error": detail})
    return {"imported": len(imported), "failed": len(errors), "items": imported, "errors": errors, "dry_run": dry_run}


@app.post("/api/integrations/email/inbound", status_code=status.HTTP_201_CREATED)
def receive_email_ticket(payload: TicketCreate, request: Request) -> dict[str, object]:
    expected = os.getenv("EMAIL_INBOUND_TOKEN", "").strip()
    supplied = request.headers.get("x-supportpilot-email-token", "")
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Email intake integration is not configured or the token is invalid.")
    if not payload.requester_email:
        raise HTTPException(status_code=422, detail="The email sender address is required.")
    return _process_ticket(payload, None)


@app.patch("/api/tickets/{ticket_id}/review", response_model=TicketResponse)
def review_ticket(
    ticket_id: UUID,
    payload: TicketReviewUpdate,
    request: Request,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    validate_origin(request)
    if current_user["role"] not in {"admin", "support_agent"}:
        raise HTTPException(status_code=403, detail="Only support staff can review flagged tickets.")
    ticket = database.get_ticket(DATABASE_PATH, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    auth.ensure_workspace_access(current_user, str(ticket["workspace"]))
    reason = payload.explanation.strip()
    if not database.update_ticket_review(DATABASE_PATH, ticket_id, payload.status, reason):
        raise HTTPException(status_code=404, detail="Ticket not found.")
    ticket["review_status"], ticket["review_reason"] = payload.status, reason
    return ticket


@app.get("/api/tickets", response_model=TicketListResponse)
def read_tickets(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    workspace: str | None = Query(default=None, max_length=80),
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    requester_id: int | None = None
    if current_user["role"] == "requester":
        requester_id = int(current_user["user_id"])
    else:
        scoped_workspace = current_user.get("workspace_scope")
        if workspace:
            auth.ensure_workspace_access(current_user, workspace)
        elif current_user["role"] == "support_agent" and scoped_workspace not in (None, "all"):
            workspace = str(scoped_workspace)
    return {
        "items": database.list_tickets(DATABASE_PATH, limit, offset, workspace, requester_id),
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/tickets/{ticket_id}", response_model=TicketResponse)
def read_ticket(
    ticket_id: UUID,
    current_user: dict[str, object] = Depends(auth.get_current_user),
) -> dict[str, object]:
    ticket = database.get_ticket(DATABASE_PATH, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    if current_user["role"] == "requester":
        if ticket.get("requester_user_id") != int(current_user["user_id"]):
            raise HTTPException(status_code=404, detail="Ticket not found.")
    else:
        auth.ensure_workspace_access(current_user, str(ticket["workspace"]))
    return ticket


def route_team(workspace: str, category: str, ticket_type: str) -> str:
    if workspace == "Facilities Helpdesk":
        return {
            "HVAC": "Facilities · HVAC & Climate",
            "Plumbing": "Facilities · Plumbing",
            "Electrical": "Facilities · Electrical",
            "Cleaning": "Facilities · Cleaning",
            "Furniture": "Facilities · Workplace Services",
            "Building Access": "Facilities · Building Access",
            "Safety": "Facilities · Safety",
            "Other": "Facilities · General Queue",
        }.get(category, "Facilities · General Queue")
    if category in {"Network", "VPN"}:
        return "Infrastructure"
    if category == "Hardware":
        return "Endpoint & Hardware"
    if category == "Account & Password":
        return "Identity & Access"
    if ticket_type == "Change":
        return "Change Management"
    return "Service Desk L1"

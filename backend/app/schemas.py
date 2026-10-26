from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class CategoryHint(str, Enum):
    network = "Network"
    account_password = "Account & Password"
    vpn = "VPN"
    software = "Software"
    hardware = "Hardware"
    system = "System"


class Impact(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Criticality(str, Enum):
    tier_1 = "tier_1"
    tier_2 = "tier_2"
    tier_3 = "tier_3"
    tier_4 = "tier_4"


class Workspace(str, Enum):
    it = "IT Service Desk"
    facilities = "Facilities Helpdesk"


class TicketCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=5, max_length=20_000)
    requester_email: EmailStr | None = None
    category: str = Field(min_length=2, max_length=80)
    workspace: Workspace
    business_impact: Impact | None = None
    affected_users: int | None = Field(default=None, ge=1, le=1_000_000)
    service_criticality: Criticality | None = None


class TicketResponse(BaseModel):
    ticket_id: UUID
    subject: str
    body: str
    requester_email: str | None
    category: str
    ticket_type: str
    ticket_type_confidence: float
    ticket_type_probabilities: dict[str, float]
    workspace: str
    assigned_team: str
    priority: str
    severity: str
    priority_raw_prediction: str
    priority_confidence: float
    priority_source: str
    priority_probabilities: dict[str, float]
    severity_score: int
    severity_confidence: float
    severity_reasoning: str
    sla: dict[str, str]
    alignment_notes: str
    business_impact: str
    affected_users: int
    service_criticality: str
    created_at: datetime
    review_status: str = "accepted"
    review_reason: str = ""


class TicketListResponse(BaseModel):
    items: list[TicketResponse]
    limit: int
    offset: int


class UserRole(str, Enum):
    requester = "requester"
    support_agent = "support_agent"
    admin = "admin"


class AuthUser(BaseModel):
    user_id: int
    email: EmailStr
    display_name: str
    role: UserRole
    workspace_scope: str | None = None


class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class AdminUserCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    role: UserRole
    workspace_scope: str | None = None


class AdminUserView(AuthUser):
    is_active: bool
    created_at: datetime


class UserListResponse(BaseModel):
    items: list[AdminUserView]


class SupportAgentView(BaseModel):
    user_id: int
    display_name: str
    workspace_scope: str | None


class SupportAgentListResponse(BaseModel):
    items: list[SupportAgentView]


class KnowledgeArticleCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=5, max_length=180)
    summary: str = Field(min_length=10, max_length=500)
    content: str = Field(min_length=20, max_length=20_000)
    category: str = Field(min_length=2, max_length=80)
    workspace: Workspace
    keywords: list[str] = Field(default_factory=list, max_length=30)
    is_published: bool = False


class KnowledgeArticleUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str | None = Field(default=None, min_length=5, max_length=180)
    summary: str | None = Field(default=None, min_length=10, max_length=500)
    content: str | None = Field(default=None, min_length=20, max_length=20_000)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    workspace: Workspace | None = None
    keywords: list[str] | None = Field(default=None, max_length=30)
    is_published: bool | None = None


class KnowledgeArticleView(BaseModel):
    article_id: str
    title: str
    summary: str
    content: str
    category: str
    workspace: Workspace
    keywords: list[str]
    is_published: bool
    owner: str
    created_at: datetime
    updated_at: datetime


class KnowledgeArticleListResponse(BaseModel):
    items: list[KnowledgeArticleView]


class UserActiveUpdate(BaseModel):
    is_active: bool


class TicketReviewUpdate(BaseModel):
    status: str = Field(pattern="^(accepted|discarded)$")
    explanation: str = Field(min_length=5, max_length=500)

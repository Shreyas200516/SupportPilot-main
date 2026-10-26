import type { Article, Category, Priority, Severity, Ticket, TicketType, Workspace } from "./data";

const API_BASE = (import.meta.env["VITE_API_URL"] ?? "http://localhost:8000").replace(/\/$/, "");

export interface TicketIntakeInput {
  subject: string;
  body: string;
  requester_email: string | null;
  workspace: Workspace;
  category: Category;
  business_impact: "low" | "medium" | "high" | "critical";
  affected_users: number;
  service_criticality: "tier_1" | "tier_2" | "tier_3" | "tier_4";
}

export type AuthRole = "requester" | "support_agent" | "admin";
export interface AuthUser {
  user_id: number;
  email: string;
  display_name: string;
  role: AuthRole;
  workspace_scope: Workspace | "all" | null;
}

export interface SupportAgentRecord {
  user_id: number;
  display_name: string;
  workspace_scope: Workspace | "all" | null;
}

export type KnowledgeArticleInput = Pick<
  Article,
  "title" | "summary" | "content" | "category" | "workspace" | "keywords" | "is_published"
>;

export async function listKnowledgeArticles(
  filters: { q?: string; category?: string; workspace?: Workspace } = {},
): Promise<Article[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.workspace) params.set("workspace", filters.workspace);
  const suffix = params.size ? `?${params.toString()}` : "";
  const result = await request<{ items: Article[] }>(`/api/knowledge/articles${suffix}`);
  return result.items;
}

export function getKnowledgeArticle(id: string): Promise<Article> {
  return request<Article>(`/api/knowledge/articles/${encodeURIComponent(id)}`);
}

export function createKnowledgeArticle(input: KnowledgeArticleInput): Promise<Article> {
  return request<Article>("/api/knowledge/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateKnowledgeArticle(
  id: string,
  input: Partial<KnowledgeArticleInput>,
): Promise<Article> {
  return request<Article>(`/api/knowledge/articles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface ApiTicket {
  ticket_id: string;
  subject: string;
  body: string;
  requester_email: string | null;
  workspace: Workspace;
  category: string;
  ticket_type: TicketType;
  ticket_type_confidence: number;
  ticket_type_probabilities: Record<string, number>;
  assigned_team: string;
  priority: string;
  severity: string;
  priority_raw_prediction: string;
  priority_confidence: number;
  priority_source: string;
  priority_probabilities: Record<string, number>;
  severity_score: number;
  severity_confidence: number;
  severity_reasoning: string;
  sla: { response_time: string; resolution_time: string; escalation: string };
  alignment_notes: string;
  business_impact: string;
  affected_users: number;
  service_criticality: string;
  created_at: string;
  review_status: "accepted" | "needs_review" | "discarded";
  review_reason: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "The ticket API did not respond within 20 seconds. Check the backend terminal.",
      );
    }
    throw new Error("Can't reach the ticket API. Start the backend and try again.");
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail =
      typeof result?.detail === "string"
        ? result.detail
        : `Ticket request failed (${response.status}).`;
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me");
}

export function signIn(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function signUpRequester(
  email: string,
  display_name: string,
  password: string,
): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, display_name, password }),
  });
}

export function signOut(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export async function listSupportAgents(): Promise<SupportAgentRecord[]> {
  const result = await request<{ items: SupportAgentRecord[] }>("/api/support/agents");
  return result.items;
}

export function createApiTicket(input: TicketIntakeInput): Promise<ApiTicket> {
  return request<ApiTicket>("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function listApiTickets(): Promise<ApiTicket[]> {
  const result = await request<{ items: ApiTicket[] }>("/api/tickets?limit=200&offset=0");
  return result.items;
}

export function apiTicketToUi(api: ApiTicket, base?: Omit<Ticket, "id">): Ticket {
  const created = new Date(api.created_at).toISOString();
  const email = api.requester_email ?? "";
  const name = email
    ? email
        .split("@")[0]!
        .split(/[._-]/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(" ")
    : "Requester";
  const resolutionHours = Number.parseInt(api.sla.resolution_time, 10) || 8;
  const category = api.category as Category;
  const type = api.ticket_type;
  const confidence = Math.round(api.ticket_type_confidence * 100);
  const ticket: Ticket = {
    id: api.ticket_id,
    subject: api.subject,
    description: api.body,
    requester: { name, email, dept: "—", title: "Employee", location: "—" },
    device: "Not specified",
    impact: api.business_impact,
    attachments: [],
    category,
    workspace: api.workspace,
    ticketType: type,
    ticketTypeConfidence: confidence,
    priority: api.priority.toLowerCase() as Priority,
    severity: api.severity as Severity,
    severityScore: api.severity_score,
    severityReasoning: api.severity_reasoning,
    status: "new",
    assignee: null,
    team: api.assigned_team,
    created,
    slaDue: new Date(new Date(created).getTime() + resolutionHours * 3_600_000).toISOString(),
    firstResponseMin: null,
    resolvedAt: null,
    ai: {
      diagnosis: `The trained classifier predicts ${type.toLowerCase()} (${confidence}% model confidence). Priority and severity are calculated separately from the submitted impact details.`,
      nextSteps: [
        "Check the model confidence and confirm the ticket type",
        "Review the matched knowledge guides before troubleshooting",
        "Confirm impact, priority, and the routed support team",
      ],
      confidence,
      explanation: `${api.alignment_notes} ${api.severity_reasoning}`,
      articles: [],
      draft: "",
    },
    steps: [
      { label: "Triage request", done: false },
      { label: "Investigate", done: false },
      { label: "Resolve and confirm", done: false },
    ],
    jira: null,
    messages: [{ id: "m1", kind: "requester", author: name, body: api.body, at: created }],
    activity: [
      {
        id: "a1",
        kind: "classification",
        text: `Model type: ${type} (${confidence}% confidence) · Priority: ${api.priority} · Severity: ${api.severity}`,
        actor: "Ticket processing",
        at: created,
      },
      {
        id: "a2",
        kind: "assignment",
        text: `Routed to ${api.assigned_team}`,
        actor: "Routing rules",
        at: created,
      },
    ],
    resolution: "",
    priorityConfidence: api.priority_confidence,
    prioritySource: api.priority_source,
    reviewStatus: api.review_status,
    reviewReason: api.review_reason,
    sla: api.sla,
  };
  return base ? { ...base, ...ticket, attachments: base.attachments, device: base.device } : ticket;
}

export interface KnowledgeAssistantResult {
  answer: string;
  mode: "knowledge_retrieval" | "rag_generation";
  language: string;
  translation_available: boolean;
  sources: Array<{
    article_id: string;
    title: string;
    summary: string;
    content: string;
    match: number;
  }>;
}

export function askKnowledgeAssistant(
  question: string,
  workspace: Workspace,
  language: "en" | "hi" | "kn" = "en",
): Promise<KnowledgeAssistantResult> {
  return request<KnowledgeAssistantResult>("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, workspace, language }),
  });
}

export interface DiagnosisResult {
  ticket_type: string;
  ticket_type_confidence: number;
  ticket_type_probabilities: Record<string, number>;
  priority: { predicted_priority: string; confidence: number; model_source: string };
  severity: { level: string; confidence: number; reasoning: string };
  explanation: string;
}

export function diagnoseTicket(input: TicketIntakeInput): Promise<DiagnosisResult> {
  return request<DiagnosisResult>("/api/assistant/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function importTicketsCsv(
  file: File,
  dryRun = false,
): Promise<{
  imported: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
  dry_run: boolean;
}> {
  const form = new FormData();
  form.append("file", file);
  return request(`/api/tickets/import-csv?dry_run=${dryRun}`, { method: "POST", body: form });
}

export function reviewTicket(
  id: string,
  status: "accepted" | "discarded",
  explanation: string,
): Promise<ApiTicket> {
  return request<ApiTicket>(`/api/tickets/${encodeURIComponent(id)}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, explanation }),
  });
}

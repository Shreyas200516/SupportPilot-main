export const currentTime = () => new Date();
export const ORG = "SupportPilot";
export const WORKSPACE = "IT Service Desk";

export type Category =
  | "Network"
  | "Account & Password"
  | "VPN"
  | "Software"
  | "Hardware"
  | "System"
  | "HVAC"
  | "Plumbing"
  | "Electrical"
  | "Cleaning"
  | "Furniture"
  | "Building Access"
  | "Safety"
  | "Other";
export type Workspace = "IT Service Desk" | "Facilities Helpdesk";
export type TicketType = "Incident" | "Request" | "Problem" | "Change";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export const FACILITIES_CATEGORIES: Category[] = [
  "HVAC",
  "Plumbing",
  "Electrical",
  "Cleaning",
  "Furniture",
  "Building Access",
  "Safety",
  "Other",
];
export type Priority = "critical" | "high" | "medium" | "low";
export type Status = "new" | "open" | "waiting" | "escalated" | "resolved";

export const CATEGORIES: Category[] = [
  "Network",
  "Account & Password",
  "VPN",
  "Software",
  "Hardware",
  "System",
];
export const categoriesForWorkspace = (workspace: Workspace): Category[] =>
  workspace === "Facilities Helpdesk" ? FACILITIES_CATEGORIES : CATEGORIES;
export const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];
export const STATUSES: Status[] = ["new", "open", "waiting", "escalated", "resolved"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  open: "Open",
  waiting: "Waiting on requester",
  escalated: "Escalated",
  resolved: "Resolved",
};

export interface Agent {
  id: string;
  name: string;
  initials: string;
  workspace: Workspace;
}

export const agentById = (id: string | null, agents: Agent[] = []) =>
  agents.find((agent) => agent.id === id) ?? null;
export const agentsForWorkspace = (workspace: Workspace, agents: Agent[] = []) =>
  agents.filter((agent) => agent.workspace === workspace);
export interface Article {
  article_id: string;
  title: string;
  summary: string;
  category: Category;
  workspace: Workspace;
  content: string;
  keywords: string[];
  is_published: boolean;
  owner: string;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: string;
  kind: "requester" | "agent" | "note" | "system";
  author: string;
  body: string;
  at: string; // ISO
}
export interface Activity {
  id: string;
  kind: "classification" | "assignment" | "agent" | "integration" | "status" | "ai";
  text: string;
  actor: string;
  at: string;
}
export interface Ticket {
  id: string;
  subject: string;
  description: string;
  requester: { name: string; email: string; dept: string; title: string; location: string };
  device: string;
  impact: string;
  attachments: { name: string; size: string }[];
  category: Category;
  workspace?: Workspace;
  ticketType?: TicketType;
  ticketTypeConfidence?: number;
  severity?: "Critical" | "High" | "Medium" | "Low";
  severityScore?: number;
  severityReasoning?: string;
  priorityConfidence?: number;
  prioritySource?: string;
  reviewStatus?: "accepted" | "needs_review" | "discarded";
  reviewReason?: string;
  sla?: { response_time: string; resolution_time: string; escalation: string };
  priority: Priority;
  status: Status;
  assignee: string | null;
  team: string;
  created: string;
  slaDue: string;
  firstResponseMin: number | null;
  resolvedAt: string | null;
  ai: {
    diagnosis: string;
    nextSteps: string[];
    confidence: number;
    explanation: string;
    articles: string[];
    draft: string;
  };
  steps: { label: string; done: boolean }[];
  jira: { key: string; state: "Synced" | "Pending" | "Error" } | null;
  messages: Message[];
  activity: Activity[];
  resolution: string;
}

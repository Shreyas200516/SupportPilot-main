import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Lightbulb, Paperclip, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, categoriesForWorkspace, currentTime, type Category } from "@/lib/data";
import { nowIso, useStore } from "@/lib/store";
import {
  askKnowledgeAssistant,
  diagnoseTicket,
  listKnowledgeArticles,
  type DiagnosisResult,
  type KnowledgeAssistantResult,
  type TicketIntakeInput,
} from "@/lib/api";
import type { Article } from "@/lib/data";
import { Chip } from "./chips";
import { cn } from "@/lib/utils";

const KEYWORDS: Record<Category, string[]> = {
  VPN: ["vpn", "globalprotect", "remote", "gateway"],
  Network: ["wifi", "wi-fi", "internet", "network", "printer", "ethernet"],
  "Account & Password": ["password", "locked", "okta", "mfa", "login", "sign in", "access"],
  Software: ["install", "license", "adobe", "teams", "software", "app"],
  Hardware: ["laptop", "monitor", "dock", "keyboard", "charger", "power", "screen"],
  System: ["outlook", "slow", "crash", "blue screen", "update", "freeze"],
  HVAC: ["hvac", "heating", "air conditioning", "temperature", "ventilation", "thermostat"],
  Plumbing: ["leak", "pipe", "toilet", "sink", "drain", "water"],
  Electrical: ["power", "outlet", "lighting", "light", "electrical", "breaker"],
  Cleaning: ["cleaning", "spill", "waste", "sanitation", "dirty"],
  Furniture: ["desk", "chair", "furniture", "workstation", "cabinet"],
  "Building Access": ["badge", "door", "key", "building access", "entry"],
  Safety: ["safety", "hazard", "injury", "fire", "smoke"],
  Other: [],
};

function suggest(
  text: string,
  categories: Category[],
): { category: Category; score: number } | null {
  const t = text.toLowerCase();
  let best: Category | null = null;
  let score = 0;
  for (const c of categories) {
    const s = KEYWORDS[c].filter((k) => t.includes(k)).length;
    if (s > score) {
      score = s;
      best = c;
    }
  }
  if (!best) return null;
  return { category: best, score };
}

export function IntakeForm({ compact, onDone }: { compact?: boolean; onDone?: () => void }) {
  const { createTicket, workspace, user } = useStore();
  const availableCategories = categoriesForWorkspace(workspace);
  const [f, setF] = useState({
    subject: "",
    description: "",
    category: "" as Category | "",
    device: "",
    impact: "",
    affectedUsers: "1",
    criticality: "tier_3" as TicketIntakeInput["service_criticality"],
    email: "",
    files: [] as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [knowledgeArticles, setKnowledgeArticles] = useState<Article[]>([]);
  const [assistantResult, setAssistantResult] = useState<KnowledgeAssistantResult | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantLanguage, setAssistantLanguage] = useState<"en" | "hi" | "kn">("en");
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [diagnosisBusy, setDiagnosisBusy] = useState(false);
  useEffect(() => {
    if (user?.role === "requester") setF((current) => ({ ...current, email: user.email }));
  }, [user]);
  useEffect(() => {
    let active = true;
    listKnowledgeArticles({ workspace })
      .then((items) => {
        if (active) setKnowledgeArticles(items);
      })
      .catch(() => {
        if (active) setKnowledgeArticles([]);
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  const set = (k: keyof typeof f, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  async function askAssistant() {
    if (text.trim().length < 4) return;
    setAssistantBusy(true);
    try {
      setAssistantResult(await askKnowledgeAssistant(text, workspace, assistantLanguage));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The support assistant is unavailable.");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function analyzeTicket() {
    if (!f.category || text.trim().length < 8) return;
    setDiagnosisBusy(true);
    try {
      setDiagnosis(
        await diagnoseTicket({
          subject: f.subject.trim(),
          body: f.description.trim(),
          requester_email: f.email.trim(),
          workspace,
          category: f.category as Category,
          business_impact: (f.impact || "medium") as TicketIntakeInput["business_impact"],
          affected_users: Number(f.affectedUsers) || 1,
          service_criticality: f.criticality,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ticket analysis failed.");
    } finally {
      setDiagnosisBusy(false);
    }
  }

  const text = `${f.subject} ${f.description}`;
  const ai = useMemo(
    () => (text.trim().length > 8 ? suggest(text, availableCategories) : null),
    [text, availableCategories],
  );
  const articles = useMemo(() => {
    const cat = f.category || ai?.category;
    if (!cat) return [];
    const query = text.toLowerCase();
    return knowledgeArticles
      .filter((article) => article.is_published)
      .map((article) => ({
        article,
        score:
          (article.category === cat ? 4 : 0) +
          article.keywords.filter((word) => query.includes(word.toLowerCase())).length,
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(({ article }) => article);
  }, [f.category, ai, knowledgeArticles, text]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (f.subject.trim().length < 5) er["subject"] = "Add a short subject (at least 5 characters).";
    if (f.description.trim().length < 20)
      er["description"] = "Describe the issue in a little more detail (20+ characters).";
    if (!f.category) er["category"] = "Choose a category.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) er["email"] = "Enter a valid work email.";
    if (!Number.isInteger(Number(f.affectedUsers)) || Number(f.affectedUsers) < 1)
      er["affectedUsers"] = "Enter at least one affected user.";
    setErrors(er);
    if (Object.keys(er).length) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSubmitting(true);
    try {
      const name = (f.email.split("@")[0] ?? "")
        .split(".")
        .map((p) => (p[0]?.toUpperCase() ?? "") + p.slice(1))
        .join(" ");
      const cat = f.category as Category;
      const impactValues = {
        low: "Just me, minor inconvenience",
        medium: "Can't do part of my job",
        high: "Can't work at all / multiple people blocked",
        critical: "Critical service stopped or safety risk",
      } as const;
      const ticketInput: TicketIntakeInput = {
        subject: f.subject.trim(),
        body: f.description.trim(),
        requester_email: f.email.trim() || null,
        workspace,
        category: cat,
        business_impact: (f.impact || "medium") as TicketIntakeInput["business_impact"],
        affected_users: Number(f.affectedUsers),
        service_criticality: f.criticality,
      };
      const id = await createTicket(
        {
          subject: f.subject,
          description: f.description,
          requester: { name, email: f.email, dept: "—", title: "Employee", location: "—" },
          device: f.device || "Not specified",
          impact: impactValues[ticketInput.business_impact],
          attachments: f.files.map((n) => ({ name: n, size: "—" })),
          category: cat,
          workspace,
          priority: "medium",
          status: "new",
          assignee: null,
          team:
            workspace === "Facilities Helpdesk" ? "Facilities · General Queue" : "Service Desk L1",
          created: nowIso(),
          slaDue: new Date(currentTime().getTime() + 8 * 3600_000).toISOString(),
          firstResponseMin: null,
          resolvedAt: null,
          ai: {
            diagnosis: "Ticket received and analyzed by the ticket processing service.",
            nextSteps: ["Review the request and confirm category"],
            confidence: ai?.category === cat ? 60 : 45,
            explanation:
              "The trained model predicts ticket type and priority; severity uses the submitted impact details.",
            articles: articles.map((a) => a.article_id),
            draft: "",
          },
          steps: [
            { label: "Triage request", done: false },
            { label: "Investigate", done: false },
            { label: "Resolve and confirm", done: false },
          ],
          jira: null,
          resolution: "",
          messages: [
            { id: "m1", kind: "requester", author: name, body: f.description, at: nowIso() },
          ],
          activity: [
            {
              id: "a1",
              kind: "integration",
              text: "Ticket created from intake form",
              actor: "Web intake",
              at: nowIso(),
            },
          ],
        },
        ticketInput,
      );
      setDone(id);
      toast.success(`Ticket ${id} created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ticket could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done)
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 className="size-10 text-success" />
        <h3 className="text-lg font-semibold">Request received</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your ticket ID is <span className="font-mono font-medium text-foreground">{done}</span>.
          Your request is saved. Keep the ticket ID for reference; the service desk will follow up
          through the configured contact channel.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDone(null);
              setF({
                subject: "",
                description: "",
                category: "",
                device: "",
                impact: "",
                affectedUsers: "1",
                criticality: "tier_3",
                email: user?.role === "requester" ? user.email : "",
                files: [],
              });
            }}
          >
            Submit another
          </Button>
          <Button asChild onClick={onDone}>
            <Link to="/tickets/$ticketId" params={{ ticketId: done }}>
              View ticket
            </Link>
          </Button>
        </div>
      </div>
    );

  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-danger">{errors[k]}</p>;
  const field = "space-y-1.5";

  return (
    <form onSubmit={submit} noValidate className={cn("grid gap-6", !compact && "lg:grid-cols-12")}>
      <div className={cn("space-y-4", !compact && "lg:col-span-8")}>
        <div className={field}>
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            value={f.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="e.g. VPN won't connect from home"
            aria-invalid={!!errors["subject"]}
          />
          {err("subject")}
        </div>
        <div className={field}>
          <Label htmlFor="desc">What's happening?</Label>
          <Textarea
            id="desc"
            rows={5}
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What were you trying to do, what happened instead, and any error messages."
            aria-invalid={!!errors["description"]}
          />
          {err("description")}
        </div>
        <fieldset className={field}>
          <legend className="mb-1.5 text-sm font-medium">Category</legend>
          <div className="flex flex-wrap gap-1.5">
            {(workspace === "Facilities Helpdesk"
              ? availableCategories
              : [...CATEGORIES, "Other" as const]
            ).map((c) => (
              <button
                type="button"
                key={c}
                onClick={() =>
                  set("category", c === "Other" && workspace === "IT Service Desk" ? "System" : c)
                }
                aria-pressed={f.category === c}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-muted",
                  f.category === c &&
                    "border-primary bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {err("category")}
        </fieldset>
        {ai && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/50 px-3 py-2 text-sm">
            <Sparkles className="size-4 text-terracotta" />
            <span className="text-muted-foreground">Suggested:</span>
            <Chip tone="neutral">{ai.category}</Chip>
            <span className="text-xs text-muted-foreground">
              service area suggested from your description; final ticket type and priority come from
              the trained backend models
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-7"
              onClick={() => {
                set("category", ai.category);
              }}
            >
              Apply
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={field}>
            <Label htmlFor="device">Affected device or system</Label>
            <Input
              id="device"
              value={f.device}
              onChange={(e) => set("device", e.target.value)}
              placeholder="e.g. MacBook Pro, Outlook"
            />
          </div>
          <div className={field}>
            <Label htmlFor="email">Your work email</Label>
            <Input
              id="email"
              type="email"
              value={f.email}
              readOnly={user?.role === "requester"}
              onChange={(e) => set("email", e.target.value)}
              placeholder="test@gmail.com"
              aria-invalid={!!errors["email"]}
            />
            {err("email")}
          </div>
          <div className={field}>
            <Label htmlFor="impact">Business impact</Label>
            <select
              id="impact"
              value={f.impact}
              onChange={(e) => set("impact", e.target.value)}
              className="h-9 w-full rounded-md border bg-card px-2 text-sm"
            >
              <option value="low">Minor inconvenience to one person</option>
              <option value="medium">Part of work is blocked</option>
              <option value="high">Unable to work or multiple people blocked</option>
              <option value="critical">Critical service outage or safety risk</option>
            </select>
          </div>
          <div className={field}>
            <Label htmlFor="affectedUsers">Affected users</Label>
            <Input
              id="affectedUsers"
              type="number"
              min="1"
              max="1000000"
              value={f.affectedUsers}
              onChange={(e) => set("affectedUsers", e.target.value)}
              aria-invalid={!!errors["affectedUsers"]}
            />
            {err("affectedUsers")}
          </div>
          <div className={field}>
            <Label htmlFor="criticality">Service criticality</Label>
            <select
              id="criticality"
              value={f.criticality}
              onChange={(e) =>
                set("criticality", e.target.value as TicketIntakeInput["service_criticality"])
              }
              className="h-9 w-full rounded-md border bg-card px-2 text-sm"
            >
              <option value="tier_1">Tier 1 — mission critical</option>
              <option value="tier_2">Tier 2 — business operational</option>
              <option value="tier_3">Tier 3 — productivity service</option>
              <option value="tier_4">Tier 4 — non-essential</option>
            </select>
          </div>
        </div>
        <div className={field}>
          <Label htmlFor="files" className="flex items-center gap-1.5">
            <Paperclip className="size-3.5" /> Attachments{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="files"
            type="file"
            multiple
            onChange={(e) =>
              set(
                "files",
                Array.from(e.target.files ?? []).map((x) => x.name),
              )
            }
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {onDone && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </div>
      <aside className={cn("space-y-3", !compact && "lg:col-span-4")}>
        <div className="surface p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" /> Knowledge assistant
          </div>
          <p className="text-xs text-muted-foreground">
            Searches published support guides and shows the matching sources. It does not invent
            troubleshooting steps.
          </p>
          <Label htmlFor="assistant-language" className="mt-3 block text-xs">
            Answer language
          </Label>
          <select
            id="assistant-language"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={assistantLanguage}
            onChange={(event) => setAssistantLanguage(event.target.value as "en" | "hi" | "kn")}
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="kn">Kannada</option>
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={askAssistant}
            disabled={assistantBusy || text.trim().length < 4}
          >
            {assistantBusy ? "Searching…" : "Ask about this issue"}
          </Button>
          {assistantResult && (
            <div className="mt-3 space-y-2 text-sm">
              <p>{assistantResult.answer}</p>
              <p className="text-xs text-muted-foreground">
                {assistantResult.mode === "rag_generation"
                  ? "AI response grounded in the linked published articles. Review the source steps."
                  : "Article search results; no generated answer was used."}
              </p>
              {assistantResult.sources.map((source) => (
                <Link
                  key={source.article_id}
                  to="/knowledge/$articleId"
                  params={{ articleId: source.article_id }}
                  target="_blank"
                  className="block rounded border p-2 hover:bg-muted"
                >
                  <span className="font-medium">{source.title}</span>
                  <span className="block text-xs text-muted-foreground">{source.summary}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={analyzeTicket}
              disabled={diagnosisBusy || !f.category || text.trim().length < 8}
            >
              {diagnosisBusy ? "Analyzing…" : "Analyze ticket"}
            </Button>
            {diagnosis && (
              <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs">
                <p className="font-medium">Model assessment (review before acting)</p>
                <p className="mt-1">
                  Type: {diagnosis.ticket_type} ·{" "}
                  {Math.round(diagnosis.ticket_type_confidence * 100)}% confidence
                </p>
                <p>
                  Priority: {diagnosis.priority.predicted_priority} ·{" "}
                  {Math.round(diagnosis.priority.confidence * 100)}% confidence
                </p>
                <p>Severity: {diagnosis.severity.level}</p>
                <p className="mt-1 text-muted-foreground">{diagnosis.severity.reasoning}</p>
              </div>
            )}
          </div>
        </div>
        <div className="surface p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="size-4 text-terracotta" /> Try these first
          </div>
          {articles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matching guides are configured yet. You can still submit your ticket.
            </p>
          ) : (
            <ul className="space-y-2">
              {articles.map((a) => (
                <li key={a.article_id}>
                  <Link
                    to="/knowledge/$articleId"
                    params={{ articleId: a.article_id }}
                    target="_blank"
                    className="block rounded-md border p-2.5 text-sm hover:bg-muted"
                  >
                    <div className="font-medium">{a.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {a.article_id} · {a.workspace}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </form>
  );
}

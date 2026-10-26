import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Check, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Avatar, PriorityChip, SeverityChip, SlaChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  agentsForWorkspace,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  agentById,
} from "@/lib/data";
import { ago, nowIso, useStore } from "@/lib/store";
import { reviewTicket as persistTicketReview } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/tickets/$ticketId")({ component: TicketDetail });

function TicketDetail() {
  const { ticketId } = Route.useParams();
  const { getTicket, updateTicket, addMessage, user, agents } = useStore();
  const ticket = getTicket(ticketId);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  if (!ticket)
    return (
      <AppShell title="Ticket not found">
        <div className="surface p-8 text-center">
          <h2 className="font-semibold">Ticket not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed or the link may be incorrect.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/tickets" search={{ q: undefined, view: undefined }}>
              Back to tickets
            </Link>
          </Button>
        </div>
      </AppShell>
    );

  const assignee = agentById(ticket.assignee, agents);
  const availableAgents = agentsForWorkspace(ticket.workspace ?? "IT Service Desk", agents);
  const markReviewed = async (status: "accepted" | "discarded") => {
    try {
      const updated = await persistTicketReview(ticket.id, status, status === "accepted" ? "Reviewed by support; ticket is valid." : "Reviewed by support and marked as unwanted. The record is retained for audit.");
      updateTicket(ticket.id, { reviewStatus: updated.review_status, reviewReason: updated.review_reason });
      toast.success(status === "accepted" ? "Ticket approved" : "Ticket marked as unwanted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Review could not be saved."); }
  };
  const sendReply = () => {
    if (!reply.trim()) return;
    addMessage(ticket.id, { kind: internal ? "note" : "agent", body: reply.trim() });
    setReply("");
    toast.success(internal ? "Internal note added" : "Reply added to conversation");
  };

  return (
    <AppShell
      title={ticket.subject}
      crumbs={[{ label: "Tickets", to: "/tickets" }, { label: ticket.id }]}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/tickets" search={{ q: undefined, view: undefined }}>
            <ArrowLeft /> All tickets
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <PriorityChip priority={ticket.priority} />
          {ticket.severity && <SeverityChip severity={ticket.severity} />}
          <StatusChip status={ticket.status} />
          <SlaChip ticket={ticket} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <section className="surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-muted-foreground">
                  {ticket.id} · {ticket.category}
                  {ticket.ticketType ? ` · AI type: ${ticket.ticketType}` : ""} · opened{" "}
                  {ago(ticket.created)}
                </p>
                <h1 className="mt-1 text-xl font-semibold">{ticket.subject}</h1>
              </div>
              <span className="text-xs text-muted-foreground">{ticket.requester.name}</span>
            </div>
            <p className="mt-5 whitespace-pre-wrap text-sm leading-6">{ticket.description}</p>
            <dl className="mt-5 grid gap-3 border-t pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Requester</dt>
                <dd className="mt-1 font-medium">{ticket.requester.name}</dd>
                <dd className="text-xs text-muted-foreground">{ticket.requester.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Device / system</dt>
                <dd className="mt-1">{ticket.device}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Business impact</dt>
                <dd className="mt-1">{ticket.impact}</dd>
              </div>
            </dl>
            {(ticket.reviewStatus === "needs_review" || ticket.reviewStatus === "discarded") && (
              <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                <div className="font-medium">{ticket.reviewStatus === "discarded" ? "Marked as unwanted" : "Needs a human review"}</div>
                <p className="mt-1 text-muted-foreground">{ticket.reviewReason}</p>
                {user && user.role !== "requester" && ticket.reviewStatus === "needs_review" && <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void markReviewed("accepted")}>Approve ticket</Button><Button size="sm" variant="destructive" onClick={() => void markReviewed("discarded")}>Mark unwanted</Button></div>}
              </div>
            )}
            {ticket.ticketTypeConfidence !== undefined && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm"><div className="font-medium">Model confidence</div><p className="mt-1 text-muted-foreground">Ticket type: {ticket.ticketTypeConfidence}% · Priority: {Math.round((ticket.priorityConfidence ?? 0) * 100)}%. Review lower-confidence results before acting.</p></div>
            )}
            {ticket.severityReasoning && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Automated assessment</div>
                <p className="mt-1 text-muted-foreground">{ticket.severityReasoning}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Routed to {ticket.team} · {ticket.sla?.response_time ?? "Response SLA pending"}{" "}
                  first response · {ticket.sla?.resolution_time ?? "Resolution SLA pending"}{" "}
                  resolution
                </p>
              </div>
            )}
          </section>
          <section className="surface p-5">
            <h2 className="font-semibold">Conversation</h2>
            <ol className="mt-4 space-y-4">
              {ticket.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-md border p-3 ${m.kind === "note" ? "border-warning/40 bg-warning/5" : ""}`}
                >
                  <div className="flex justify-between gap-3 text-xs">
                    <span className="font-medium">
                      {m.author}
                      {m.kind === "note" ? " · Internal note" : ""}
                    </span>
                    <time className="text-muted-foreground">{ago(m.at)}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-5 border-t pt-4">
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-xs ${!internal ? "bg-primary text-primary-foreground" : ""}`}
                  onClick={() => setInternal(false)}
                >
                  Reply
                </button>
                <button
                  type="button"
                  className={`rounded border px-2 py-1 text-xs ${internal ? "bg-warning text-foreground" : ""}`}
                  onClick={() => setInternal(true)}
                >
                  Internal note
                </button>
              </div>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={internal ? "Add a note for teammates…" : "Write a reply…"}
                rows={4}
              />
              <div className="mt-2 flex justify-end">
                <Button onClick={sendReply} disabled={!reply.trim()}>
                  <Send /> {internal ? "Add note" : "Add reply"}
                </Button>
              </div>
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="surface space-y-4 p-4">
            <h2 className="font-semibold">Ticket properties</h2>
            <label className="block space-y-1 text-xs text-muted-foreground">
              Status
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm text-foreground"
                value={ticket.status}
                onChange={(e) => {
                  const status = e.target.value as typeof ticket.status;
                  updateTicket(
                    ticket.id,
                    { status, resolvedAt: status === "resolved" ? nowIso() : null },
                    {
                      kind: "status",
                      text: `Status changed to ${STATUS_LABEL[status]}`,
                    },
                  );
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              Priority
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm text-foreground"
                value={ticket.priority}
                onChange={(e) =>
                  updateTicket(
                    ticket.id,
                    { priority: e.target.value as typeof ticket.priority },
                    {
                      kind: "agent",
                      text: `Priority changed to ${PRIORITY_LABEL[e.target.value as typeof ticket.priority]}`,
                    },
                  )
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs text-muted-foreground">
              Assignee
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm text-foreground"
                value={ticket.assignee ?? ""}
                disabled={!availableAgents.length}
                onChange={(e) => {
                  const agent = agentById(e.target.value || null, agents);
                  updateTicket(
                    ticket.id,
                    { assignee: agent?.id ?? null },
                    {
                      kind: "assignment",
                      text: agent ? `Assigned to ${agent.name}` : "Ticket unassigned",
                    },
                  );
                }}
              >
                {!availableAgents.length && (
                  <option value="" disabled>
                    No support agents configured
                  </option>
                )}
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="">Unassigned</option>
              </select>
            </label>
            {assignee && (
              <div className="flex items-center gap-2 text-sm">
                <Avatar initials={assignee.initials} />
                {assignee.name}
              </div>
            )}
            <div className="border-t pt-3">
              <div className="text-xs text-muted-foreground">Resolution checklist</div>
              <ul className="mt-2 space-y-2">
                {ticket.steps.map((step, i) => (
                  <li key={`${step.label}-${i}`}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={step.done}
                        onChange={(e) => {
                          const steps = ticket.steps.map((x, j) =>
                            j === i ? { ...x, done: e.target.checked } : x,
                          );
                          updateTicket(ticket.id, { steps });
                        }}
                      />
                      <span className={step.done ? "text-muted-foreground line-through" : ""}>
                        {step.label}
                      </span>
                      {step.done && <Check className="ml-auto size-4 text-success" />}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            {ticket.jira && (
              <div className="border-t pt-3 text-xs text-muted-foreground">
                Linked issue <span className="font-mono text-foreground">{ticket.jira.key}</span> ·{" "}
                {ticket.jira.state}
              </div>
            )}
          </section>
          <section className="surface p-4">
            <h2 className="font-semibold">Activity</h2>
            <ol className="mt-3 space-y-3">
              {[...ticket.activity].reverse().map((a) => (
                <li key={a.id} className="text-sm">
                  <p>{a.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.actor} · {ago(a.at)}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Current agent: {user?.display_name ?? "Support team"}
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

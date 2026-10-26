import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Inbox,
  UserX,
  Hourglass,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ConfidenceChip, PriorityChip, SlaChip, StatusChip } from "@/components/chips";
import { Skeleton } from "@/components/ui/skeleton";
import { currentTime, PRIORITIES, PRIORITY_LABEL } from "@/lib/data";
import { ago, slaState, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview · SupportPilot" },
      {
        name: "description",
        content:
          "Operational overview of the IT service desk: open tickets, SLA risk and recent activity.",
      },
      { property: "og:title", content: "Overview · SupportPilot" },
      { property: "og:description", content: "Operational overview of the IT service desk." },
    ],
  }),
  component: Overview,
});

export const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
};
export const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" };

export function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: typeof Inbox;
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon
          className={cn(
            "size-4 text-muted-foreground",
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
          )}
        />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Overview() {
  const { tickets, workspace, user, ticketsLoading, ticketsError } = useStore();
  const [range, setRange] = useState<7 | 30>(7);
  const now = currentTime();

  const open = tickets.filter((t) => t.status !== "resolved");
  const unassigned = open.filter((t) => !t.assignee);
  const waiting = tickets.filter((t) => t.status === "waiting");
  const resolvedToday = tickets.filter(
    (t) => t.resolvedAt && new Date(t.resolvedAt).toDateString() === now.toDateString(),
  );
  const responded = tickets.filter((t) => t.firstResponseMin != null);
  const avgFr = responded.length
    ? Math.round(responded.reduce((s, t) => s + (t.firstResponseMin ?? 0), 0) / responded.length)
    : null;
  const atRisk = open.filter((t) => ["at-risk", "overdue"].includes(slaState(t)));

  const byCat = [...new Set(open.map((t) => t.category))].map((c) => ({
    name: c.replace(" & Password", "/Pwd"),
    value: open.filter((t) => t.category === c).length,
  }));
  const byPri = PRIORITIES.map((p) => ({ p, n: open.filter((t) => t.priority === p).length }));
  const attention = open
    .filter((t) => slaState(t) === "overdue" || t.priority === "critical" || t.ai.confidence < 60)
    .sort((a, b) => +new Date(a.slaDue) - +new Date(b.slaDue));
  const feed = tickets
    .flatMap((t) => t.activity.map((a) => ({ ...a, ticket: t.id })))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 8);
  const volume = Array.from({ length: range }, (_, index) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (range - index - 1));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const inDay = (value: string | null) => {
      if (!value) return false;
      const timestamp = new Date(value).getTime();
      return timestamp >= day.getTime() && timestamp < nextDay.getTime();
    };
    return {
      date: day.toLocaleDateString("en", { month: "short", day: "numeric" }),
      created: tickets.filter((ticket) => inDay(ticket.created)).length,
      resolved: tickets.filter((ticket) => inDay(ticket.resolvedAt)).length,
    };
  });

  const dateStr = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <AppShell title="Overview">
      <PageHeader
        title={`Welcome, ${(user?.display_name ?? "Support team").split(" ")[0]}`}
        subtitle={
          <>
            {dateStr} · {open.length} open tickets, {atRisk.length} at risk of breaching SLA,{" "}
            {unassigned.length} waiting for an owner.
          </>
        }
      />

      {ticketsError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          Tickets could not be loaded: {ticketsError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ticketsLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[98px] rounded-lg" />
          ))
        ) : (
          <>
            <Kpi label="Open tickets" value={open.length} hint={`In ${workspace}`} icon={Inbox} />
            <Kpi
              label="Unassigned"
              value={unassigned.length}
              hint="Need an owner"
              icon={UserX}
              {...(unassigned.length > 0 ? { tone: "warning" as const } : {})}
            />
            <Kpi
              label="Awaiting requester"
              value={waiting.length}
              hint="Paused SLA"
              icon={Hourglass}
            />
            <Kpi
              label="Resolved today"
              value={resolvedToday.length}
              hint="Since 00:00"
              icon={CheckCircle2}
              tone="success"
            />
            <Kpi
              label="Avg first response"
              value={avgFr === null ? "—" : `${avgFr}m`}
              hint={
                responded.length
                  ? `Target 30m · ${responded.length} tickets`
                  : "No response records yet"
              }
              icon={Clock}
            />
            <Kpi
              label="SLA at risk"
              value={atRisk.length}
              hint={`${atRisk.filter((t) => slaState(t) === "overdue").length} already overdue`}
              icon={ShieldAlert}
              tone="danger"
            />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-12">
        <section className="surface p-4 lg:col-span-8" aria-labelledby="vol">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 id="vol" className="text-sm font-semibold">
                Ticket volume
              </h3>
              <p className="text-xs text-muted-foreground">
                `Created vs. resolved per day · last ${range} days in ${workspace}`
              </p>
            </div>
            <div className="flex rounded-md border p-0.5 text-xs" role="tablist">
              {[7, 30].map((r) => (
                <button
                  key={r}
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => setRange(r as 7 | 30)}
                  className={cn(
                    "rounded px-2.5 py-1",
                    range === r
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>
          </div>
          <div className="h-60">
            {ticketsLoading ? (
              <Skeleton className="h-full" />
            ) : tickets.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                No ticket history yet. Ticket activity will appear here after tickets are submitted.
              </div>
            ) : (
              <ResponsiveContainer>
                <AreaChart data={volume} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    interval={range === 30 ? 4 : 0}
                  />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    dataKey="created"
                    name="Created"
                    stroke="var(--chart-5)"
                    fill="var(--chart-5)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                  <Area
                    dataKey="resolved"
                    name="Resolved"
                    stroke="var(--chart-1)"
                    fill="var(--chart-1)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-chart-5" /> Created
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-chart-1" /> Resolved
            </span>
          </div>
        </section>

        <section className="surface p-4 lg:col-span-4">
          <h3 className="text-sm font-semibold">Priority distribution</h3>
          <p className="mb-4 text-xs text-muted-foreground">Open tickets</p>
          <div className="space-y-3">
            {byPri.map(({ p, n }) => (
              <div key={p}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{PRIORITY_LABEL[p]}</span>
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-2 rounded-full",
                      p === "critical"
                        ? "bg-danger"
                        : p === "high"
                          ? "bg-warning"
                          : p === "medium"
                            ? "bg-chart-5"
                            : "bg-border",
                    )}
                    style={{ width: `${(n / Math.max(open.length, 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <h3 className="mt-6 text-sm font-semibold">Tickets by category</h3>
          <div className="mt-2 h-40">
            <ResponsiveContainer>
              <BarChart data={byCat} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={axisTick}
                  width={80}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
                <Bar
                  dataKey="value"
                  name="Open"
                  fill="var(--chart-1)"
                  radius={[0, 3, 3, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="surface lg:col-span-7">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-danger" /> Needs attention
              </h3>
              <p className="text-xs text-muted-foreground">
                Overdue, critical, or low-confidence AI suggestions
              </p>
            </div>
            <Link
              to="/tickets"
              search={{ q: undefined, view: undefined }}
              className="flex items-center gap-1 text-xs font-medium hover:underline"
            >
              All tickets <ArrowRight className="size-3" />
            </Link>
          </div>
          {attention.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="divide-y">
              {attention.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/tickets/$ticketId"
                    params={{ ticketId: t.id }}
                    className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{t.id}</span>· {t.requester.name}
                      </div>
                      <div className="truncate text-sm font-medium">{t.subject}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PriorityChip priority={t.priority} />
                      {t.ai.confidence < 60 && <ConfidenceChip value={t.ai.confidence} />}
                      <SlaChip ticket={t} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface lg:col-span-5">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          <ol className="space-y-0 px-4 py-2">
            {feed.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">
                No ticket activity yet.
              </li>
            ) : (
              feed.map((a) => (
                <li key={a.ticket + a.id} className="flex gap-3 py-2">
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      a.kind === "status"
                        ? "bg-success"
                        : a.kind === "classification"
                          ? "bg-terracotta"
                          : a.kind === "integration"
                            ? "bg-warning"
                            : "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 text-sm">
                    <div className="truncate">{a.text}</div>
                    <div className="text-xs text-muted-foreground">
                      <Link
                        to="/tickets/$ticketId"
                        params={{ ticketId: a.ticket }}
                        className="font-mono hover:underline"
                      >
                        {a.ticket}
                      </Link>{" "}
                      · {a.actor} · {ago(a.at)}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ol>
        </section>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
        Status key: <StatusChip status="new" />
        <StatusChip status="open" />
        <StatusChip status="waiting" />
        <StatusChip status="escalated" />
        <StatusChip status="resolved" />
      </div>
    </AppShell>
  );
}

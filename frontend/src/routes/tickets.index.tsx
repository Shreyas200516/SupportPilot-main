import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Avatar, PriorityChip, SlaChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  agentsForWorkspace,
  categoriesForWorkspace,
  currentTime,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  agentById,
  type Ticket,
} from "@/lib/data";
import { ago, slaState, useStore } from "@/lib/store";
import { importTicketsCsv } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tickets/")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    view: typeof s["view"] === "string" ? s["view"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tickets · SupportPilot" },
      {
        name: "description",
        content: "Ticket work queue with saved views, filters and bulk actions.",
      },
      { property: "og:title", content: "Tickets · SupportPilot" },
      { property: "og:description", content: "Ticket work queue for the IT service desk." },
    ],
  }),
  component: TicketsPage,
});

const VIEWS: { id: string; label: string; fn: (t: Ticket) => boolean }[] = [
  { id: "all", label: "All tickets", fn: () => true },
  { id: "unassigned", label: "Unassigned", fn: (t) => !t.assignee && t.status !== "resolved" },
  { id: "mine", label: "My tickets", fn: () => false },
  {
    id: "high",
    label: "High priority",
    fn: (t) => (t.priority === "high" || t.priority === "critical") && t.status !== "resolved",
  },
  { id: "waiting", label: "Waiting on requester", fn: (t) => t.status === "waiting" },
  { id: "escalated", label: "Escalated", fn: (t) => t.status === "escalated" },
  { id: "resolved", label: "Resolved", fn: (t) => t.status === "resolved" },
];
type SortKey = "id" | "priority" | "created" | "sla";
const PAGE = 10;
const sel = "h-8 rounded-md border bg-card px-2 text-xs";

function TicketsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { tickets, agents, bulkUpdate, workspace, user, ticketsError, ticketsLoading } = useStore();
  const categoryOptions = categoriesForWorkspace(workspace);
  const workspaceAgents = agentsForWorkspace(workspace, agents);
  const [view, setView] = useState(search.view ?? "all");
  const [q, setQ] = useState(search.q ?? "");
  const [f, setF] = useState({
    status: "",
    priority: "",
    category: "",
    assignee: "",
    date: "",
    sla: "",
  });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<Array<{ row: number; error: string }>>([]);
  async function handleCsvImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const preview = await importTicketsCsv(file, true);
      setImportErrors(preview.errors);
      if (preview.imported === 0) {
        toast.error("No valid ticket rows were found. Review the row errors before importing.");
        return;
      }
      const confirmed = window.confirm(
        `Preview complete: ${preview.imported} valid ticket row(s), ${preview.failed} row(s) with errors. Import the valid rows now?`,
      );
      if (!confirmed) return;
      const result = await importTicketsCsv(file);
      setImportErrors(result.errors);
      toast.success(`Imported ${result.imported} tickets; ${result.failed} rows need correction.`);
      if (result.imported) window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV import failed.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  const filtered = useMemo(() => {
    const v = VIEWS.find((x) => x.id === view)!;
    const qq = q.toLowerCase().trim();
    const pr = { critical: 0, high: 1, medium: 2, low: 3 };
    return tickets
      .filter((t) =>
        view === "mine" ? t.assignee === String(user?.user_id) && t.status !== "resolved" : v.fn(t),
      )
      .filter(
        (t) =>
          !qq ||
          [t.id, t.subject, t.requester.name, t.category].some((x) => x.toLowerCase().includes(qq)),
      )
      .filter((t) => !f.status || t.status === f.status)
      .filter((t) => !f.priority || t.priority === f.priority)
      .filter((t) => !f.category || t.category === f.category)
      .filter(
        (t) => !f.assignee || (f.assignee === "none" ? !t.assignee : t.assignee === f.assignee),
      )
      .filter((t) => !f.sla || slaState(t) === f.sla)
      .filter(
        (t) =>
          !f.date || currentTime().getTime() - +new Date(t.created) < Number(f.date) * 3600_000,
      )
      .sort((a, b) => {
        const k = sort.key;
        const va =
          k === "id"
            ? a.id
            : k === "priority"
              ? pr[a.priority]
              : k === "created"
                ? +new Date(a.created)
                : +new Date(a.slaDue);
        const vb =
          k === "id"
            ? b.id
            : k === "priority"
              ? pr[b.priority]
              : k === "created"
                ? +new Date(b.created)
                : +new Date(b.slaDue);
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      });
  }, [tickets, view, q, f, sort, user?.user_id]);

  const counts = Object.fromEntries(
    VIEWS.map((v) => [
      v.id,
      v.id === "mine"
        ? tickets.filter((t) => t.assignee === String(user?.user_id) && t.status !== "resolved")
            .length
        : tickets.filter(v.fn).length,
    ]),
  );
  const shown = filtered.slice(0, limit);
  const allSel = shown.length > 0 && shown.every((t) => selected.includes(t.id));
  const activeFilters = Object.values(f).filter(Boolean).length + (q ? 1 : 0);

  const SortH = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      className={cn("px-3 py-2 font-medium", className)}
      aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}
      >
        {children}
        {sort.key === k &&
          (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  function bulk(kind: string, value: string) {
    if (!value) return;
    if (kind === "assignee") {
      const agent = agentById(value, agents);
      bulkUpdate(selected, { assignee: value }, `Assigned to ${agent?.name ?? "support agent"}`);
    }
    if (kind === "status")
      bulkUpdate(
        selected,
        { status: value as Ticket["status"] },
        `Status changed to ${STATUS_LABEL[value as Ticket["status"]]}`,
      );
    if (kind === "priority")
      bulkUpdate(
        selected,
        { priority: value as Ticket["priority"] },
        `Priority changed to ${PRIORITY_LABEL[value as Ticket["priority"]]}`,
      );
    toast.success(`Updated ${selected.length} ticket${selected.length > 1 ? "s" : ""}`);
    setSelected([]);
  }

  return (
    <AppShell title="Tickets">
      <PageHeader
        title={workspace === "Facilities Helpdesk" ? "Facilities tickets" : "Tickets"}
        subtitle={`${filtered.length} of ${tickets.length} tickets in ${workspace}`}
      />
      {user?.role !== "requester" && (
        <div className="surface mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          <label htmlFor="ticket-csv" className="font-medium">
            Import tickets from CSV
          </label>
          <input
            id="ticket-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void handleCsvImport(event)}
            disabled={importing}
          />
          <span className="text-xs text-muted-foreground">
            Required columns: subject, body, category, workspace. Optional: requester_email,
            business_impact, affected_users, service_criticality. Maximum 5,000 rows.
          </span>
          {importing && <span>Importing…</span>}
          {importErrors.length > 0 && (
            <ul className="basis-full text-xs text-destructive">
              {importErrors.slice(0, 20).map((item) => (
                <li key={item.row}>
                  Row {item.row}: {item.error}
                </li>
              ))}
              {importErrors.length > 20 && <li>…and {importErrors.length - 20} more row errors</li>}
            </ul>
          )}
        </div>
      )}
      {workspaceAgents.length === 0 && user?.role !== "requester" && (
        <div className="surface mb-4 flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>
            No support agents are configured for {workspace}, so tickets cannot be assigned yet.
          </span>
          <a
            className="font-medium text-primary underline"
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open admin API docs to add accounts
          </a>
        </div>
      )}

      <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-1 border-b" role="tablist" aria-label="Saved views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => {
                setView(v.id);
                setSelected([]);
                setLimit(PAGE);
              }}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                view === v.id
                  ? "border-terracotta font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
              <span className="rounded-sm bg-muted px-1 text-xs tabular-nums">{counts[v.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="tq" className="sr-only">
            Search tickets
          </label>
          <input
            id="tq"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ID, subject, requester"
            className="h-8 w-full rounded-md border bg-card pl-8 pr-2 text-sm"
          />
        </div>
        <select
          aria-label="Status"
          className={sel}
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value })}
        >
          <option value="">Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority"
          className={sel}
          value={f.priority}
          onChange={(e) => setF({ ...f, priority: e.target.value })}
        >
          <option value="">Priority</option>
          {PRIORITIES.map((s) => (
            <option key={s} value={s}>
              {PRIORITY_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Category"
          className={sel}
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
        >
          <option value="">Category</option>
          {categoryOptions.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Assignee"
          className={sel}
          value={f.assignee}
          onChange={(e) => setF({ ...f, assignee: e.target.value })}
        >
          <option value="">Assignee</option>
          <option value="none">Unassigned</option>
          {workspaceAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Created"
          className={sel}
          value={f.date}
          onChange={(e) => setF({ ...f, date: e.target.value })}
        >
          <option value="">Any date</option>
          <option value="4">Last 4 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
        </select>
        <select
          aria-label="SLA state"
          className={sel}
          value={f.sla}
          onChange={(e) => setF({ ...f, sla: e.target.value })}
        >
          <option value="">SLA</option>
          <option value="overdue">Overdue</option>
          <option value="at-risk">At risk</option>
          <option value="on-track">On track</option>
          <option value="met">Met</option>
        </select>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF({ status: "", priority: "", category: "", assignee: "", date: "", sla: "" });
              setQ("");
              navigate({ to: "/tickets", search: { q: undefined, view: undefined } });
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          <span className="font-medium">{selected.length} selected</span>
          <select
            aria-label="Assign selected"
            className="h-7 rounded border-0 bg-sidebar-accent px-2 text-xs"
            value=""
            disabled={workspaceAgents.length === 0}
            onChange={(e) => bulk("assignee", e.target.value)}
          >
            <option value="">
              {workspaceAgents.length ? "Assign to…" : "No support agents configured"}
            </option>
            {workspaceAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Set status"
            className="h-7 rounded border-0 bg-sidebar-accent px-2 text-xs"
            value=""
            onChange={(e) => bulk("status", e.target.value)}
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Set priority"
            className="h-7 rounded border-0 bg-sidebar-accent px-2 text-xs"
            value=""
            onChange={(e) => bulk("priority", e.target.value)}
          >
            <option value="">Set priority…</option>
            {PRIORITIES.map((s) => (
              <option key={s} value={s}>
                {PRIORITY_LABEL[s]}
              </option>
            ))}
          </select>
          <button className="ml-auto text-xs underline" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}

      <div className="surface overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium">
              {ticketsLoading
                ? "Loading tickets…"
                : ticketsError
                  ? "Tickets could not be loaded"
                  : tickets.length === 0
                    ? `No tickets yet in ${workspace}`
                    : "No tickets match these filters"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {ticketsError ??
                (tickets.length === 0
                  ? "Create a request to start this helpdesk queue."
                  : "Try a different view or clear filters.")}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox
                        aria-label="Select all"
                        checked={allSel}
                        onCheckedChange={(c) => setSelected(c ? shown.map((t) => t.id) : [])}
                      />
                    </th>
                    <SortH k="id">ID</SortH>
                    <th className="px-3 py-2 font-medium">Subject</th>
                    <th className="hidden px-3 py-2 font-medium xl:table-cell">Category</th>
                    <SortH k="priority">Priority</SortH>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Assignee</th>
                    <SortH k="created" className="hidden lg:table-cell">
                      Created
                    </SortH>
                    <SortH k="sla">SLA</SortH>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((t) => {
                    const a = agentById(t.assignee, agents);
                    return (
                      <tr
                        key={t.id}
                        className={cn(
                          "cursor-pointer hover:bg-muted/50",
                          selected.includes(t.id) && "bg-terracotta-soft/40",
                        )}
                        onClick={() =>
                          navigate({ to: "/tickets/$ticketId", params: { ticketId: t.id } })
                        }
                      >
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${t.id}`}
                            checked={selected.includes(t.id)}
                            onCheckedChange={(c) =>
                              setSelected((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                          {t.id}
                        </td>
                        <td className="max-w-[320px] px-3 py-2.5">
                          <a
                            href={`/tickets/${t.id}`}
                            onClick={(e) => e.preventDefault()}
                            className="block truncate font-medium focus-visible:underline"
                          >
                            {t.subject}
                          </a>
                          <div className="truncate text-xs text-muted-foreground">
                            {t.requester.name} · {t.requester.dept}
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground xl:table-cell">
                          {t.category}
                        </td>
                        <td className="px-3 py-2.5">
                          <PriorityChip priority={t.priority} />
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusChip status={t.status} />
                        </td>
                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          {a ? (
                            <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                              <Avatar initials={a.initials} className="size-6 text-[10px]" />
                              {a.name.split(" ")[0]}
                            </span>
                          ) : (
                            <span className="text-xs text-warning">Unassigned</span>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground lg:table-cell">
                          {ago(t.created)}
                        </td>
                        <td className="px-3 py-2.5">
                          <SlaChip ticket={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y md:hidden">
              {shown.map((t) => (
                <li key={t.id} className="flex gap-3 p-3">
                  <Checkbox
                    aria-label={`Select ${t.id}`}
                    className="mt-1"
                    checked={selected.includes(t.id)}
                    onCheckedChange={(c) =>
                      setSelected((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))
                    }
                  />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                      navigate({ to: "/tickets/$ticketId", params: { ticketId: t.id } })
                    }
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono">{t.id}</span>
                      <span>{ago(t.created)}</span>
                    </div>
                    <div className="mt-0.5 text-sm font-medium">{t.subject}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.requester.name} · {t.category}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <PriorityChip priority={t.priority} />
                      <StatusChip status={t.status} />
                      <SlaChip ticket={t} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <span>
                Showing {shown.length} of {filtered.length}
              </span>
              {limit < filtered.length && (
                <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

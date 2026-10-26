import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, BookOpen, CheckCircle2, Plug, Settings, ShieldCheck } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { currentTime } from "@/lib/data";
import { listKnowledgeArticles } from "@/lib/api";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/$section")({ component: WorkspacePage });

const pageConfig = {
  analytics: {
    title: "Analytics",
    icon: BarChart3,
    description: "A live summary of ticket workload and service levels.",
  },
  integrations: {
    title: "Integrations",
    icon: Plug,
    description: "External services configured for this workspace.",
  },
  settings: {
    title: "Settings",
    icon: Settings,
    description: "Workspace preferences for this browser session.",
  },
} as const;

function WorkspacePage() {
  const { section } = Route.useParams();
  const { tickets, workspace } = useStore();
  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [digest, setDigest] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("supportpilot:daily-summary");
    if (saved !== null) setDigest(saved === "enabled");
  }, []);
  useEffect(() => {
    let active = true;
    listKnowledgeArticles({ workspace })
      .then((articles) => {
        if (active) setArticleCount(articles.length);
      })
      .catch(() => {
        if (active) setArticleCount(null);
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  const config = pageConfig[section as keyof typeof pageConfig];
  if (!config)
    return (
      <AppShell title="Page not found">
        <div className="surface p-8 text-center">
          <h2 className="font-semibold">Page not found</h2>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/">Return to overview</Link>
          </Button>
        </div>
      </AppShell>
    );

  if (section === "analytics") {
    const open = tickets.filter((t) => t.status !== "resolved").length;
    const resolved = tickets.filter((t) => t.status === "resolved").length;
    const unassigned = tickets.filter((t) => t.status !== "resolved" && !t.assignee).length;
    const risks = tickets.filter(
      (t) =>
        t.status !== "resolved" &&
        new Date(t.slaDue).getTime() < currentTime().getTime() + 120 * 60_000,
    ).length;
    const byCategory = [...new Set(tickets.map((t) => t.category))].map((c) => ({
      label: c,
      count: tickets.filter((t) => t.category === c && t.status !== "resolved").length,
    }));
    return (
      <AppShell title={config.title}>
        <PageHeader title={config.title} subtitle={config.description} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Open tickets", open],
            ["Resolved", resolved],
            ["Unassigned", unassigned],
            ["SLA due within 2 hours", risks],
          ].map(([label, value]) => (
            <div key={label} className="surface p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <section className="surface mt-4 p-4">
          <h2 className="font-semibold">Open tickets by category</h2>
          <div className="mt-4 space-y-3">
            {byCategory.map(({ label, count }) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-chart-1"
                    style={{ width: `${(count / Math.max(open, 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Figures are calculated from tickets saved in this workspace.
          </p>
        </section>
      </AppShell>
    );
  }

  if (section === "integrations")
    return (
      <AppShell title={config.title}>
        <PageHeader title={config.title} subtitle={config.description} />
        <div className="grid gap-3 md:grid-cols-2">
          {[
            {
              name: "Jira Service Management",
              detail: "Issue linking",
              icon: CheckCircle2,
            },
            {
              name: "Knowledge Base",
              detail:
                articleCount === null
                  ? "Knowledge article service unavailable"
                  : `${articleCount} configured support guides`,
              icon: BookOpen,
            },
            {
              name: "Identity provider",
              detail: "Sign-in integration · Not configured",
              icon: ShieldCheck,
            },
          ].map((item) => (
            <section key={item.name} className="surface flex items-start gap-3 p-4">
              <item.icon className="mt-0.5 size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{item.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
              </div>
              <span className="rounded border px-2 py-1 text-xs text-muted-foreground">
                {item.name === "Jira Service Management"
                  ? "Not connected"
                  : item.name === "Knowledge Base"
                    ? articleCount !== null && articleCount > 0
                      ? "Available"
                      : "Not configured"
                    : "Setup required"}
              </span>
            </section>
          ))}
        </div>
      </AppShell>
    );

  return (
    <AppShell title={config.title}>
      <PageHeader title={config.title} subtitle={config.description} />
      <section className="surface max-w-2xl divide-y">
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <h2 className="font-medium">Daily email summary</h2>
            <p className="text-sm text-muted-foreground">
              Keep a local preference for a daily service desk summary.
            </p>
          </div>
          <input
            aria-label="Daily email summary"
            type="checkbox"
            checked={digest}
            onChange={(e) => setDigest(e.target.checked)}
          />
        </div>
        <div className="p-4">
          <h2 className="font-medium">Workspace details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Service desk · {tickets.length} saved tickets · {articleCount ?? "—"} knowledge guides
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              localStorage.setItem("supportpilot:daily-summary", digest ? "enabled" : "disabled");
              toast.success("Preference saved in this browser");
            }}
          >
            Save preferences
          </Button>
        </div>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">
        Account, notification delivery, and theme settings are not connected to a backend.
      </p>
    </AppShell>
  );
}

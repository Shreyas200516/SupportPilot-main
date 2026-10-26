import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronsUpDown,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Plus,
  Search,
  Settings,
  Inbox,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ORG } from "@/lib/data";
import { ago, useStore } from "@/lib/store";
import { Avatar } from "./chips";
import { IntakeForm } from "./intake-form";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, exact: true },
  { to: "/tickets", label: "Tickets", icon: Inbox },
  { to: "/knowledge", label: "Knowledge Base", icon: BookOpen },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { tickets, workspace, setWorkspace, user, signOut } = useStore();
  const navigate = useNavigate();
  const canChooseWorkspace =
    user?.role === "admin" || user?.workspace_scope === "all" || user?.workspace_scope == null;
  async function logout() {
    try {
      await signOut();
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign out.");
    }
  }
  const openCount = tickets.filter((t) => t.status !== "resolved").length;
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="grid size-6 place-items-center rounded-sm bg-terracotta text-[11px] font-bold text-primary-foreground">
          SP
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
          SupportPilot
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
        {NAV.map((n) => {
          const active = "exact" in n ? path === n.to : path.startsWith(n.to);
          const itemContent = (
            <>
              <n.icon className="size-4 shrink-0" />
              <span className="flex-1">{n.label}</span>
              {n.to === "/tickets" && (
                <span className="text-xs tabular-nums opacity-70">{openCount}</span>
              )}
            </>
          );
          const itemProps = {
            onClick: onNavigate,
            "aria-current": active ? ("page" as const) : undefined,
            className: cn(
              "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active &&
                "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:-left-2 before:w-0.5 before:rounded-full before:bg-sidebar-primary",
            ),
          };
          if (n.to === "/") {
            return (
              <Link key={n.to} to="/" {...itemProps}>
                {itemContent}
              </Link>
            );
          }
          if (n.to === "/tickets") {
            return (
              <Link
                key={n.to}
                to="/tickets"
                search={{ q: undefined, view: undefined }}
                {...itemProps}
              >
                {itemContent}
              </Link>
            );
          }
          if (n.to === "/knowledge") {
            return (
              <Link key={n.to} to="/knowledge" {...itemProps}>
                {itemContent}
              </Link>
            );
          }
          return (
            <Link
              key={n.to}
              to="/$section"
              params={{ section: n.to.slice(1) as "analytics" | "integrations" | "settings" }}
              {...itemProps}
            >
              {itemContent}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-sidebar-border p-2">
        <DropdownMenu>
          {canChooseWorkspace ? (
            <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-sidebar-accent">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sidebar-accent-foreground">
                  {workspace}
                </div>
                <div className="truncate opacity-70">{ORG}</div>
              </div>
              <ChevronsUpDown className="size-3.5 opacity-70" />
            </DropdownMenuTrigger>
          ) : (
            <div className="px-2.5 py-2 text-xs">
              <div className="font-medium">{user?.workspace_scope ?? workspace}</div>
              <div className="opacity-70">Workspace</div>
            </div>
          )}
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setWorkspace("IT Service Desk")}>
              IT Service Desk {workspace === "IT Service Desk" ? "✓" : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWorkspace("Facilities Helpdesk")}>
              Facilities Helpdesk {workspace === "Facilities Helpdesk" ? "✓" : ""}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-sidebar-accent"
            aria-label="Account menu"
          >
            <Avatar
              initials={(user?.display_name ?? "Account")
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
              className="bg-sidebar-primary text-sidebar-primary-foreground"
            />
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-medium text-sidebar-accent-foreground">
                {user?.display_name ?? "Account"}
              </div>
              <div className="truncate capitalize opacity-70">{user?.role.replace("_", " ")}</div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{user?.display_name ?? "Account"}</div>
              <div className="text-xs text-muted-foreground">{user?.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/$section" params={{ section: "settings" }}>
                <User className="size-4" /> Profile & preferences
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function AppShell({
  title,
  crumbs,
  actions,
  children,
}: {
  title: string;
  crumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { createOpen, setCreateOpen, user, authLoading, tickets } = useStore();
  const recentUpdates = tickets
    .flatMap((ticket) => ticket.activity.map((activity) => ({ ...activity, ticketId: ticket.id })))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5);

  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/login" });
    else if (!authLoading && user?.role === "requester") void navigate({ to: "/request" });
  }, [authLoading, user, navigate]);

  if (authLoading || !user || user.role === "requester") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Checking your access…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
        <SidebarBody />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 border-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            {crumbs && crumbs.length > 0 ? (
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
                {crumbs.map((c, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    {c.to ? (
                      <Link to={c.to} className="text-muted-foreground hover:text-foreground">
                        {c.label}
                      </Link>
                    ) : (
                      <span className="truncate font-medium">{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            ) : (
              <h1 className="truncate text-sm font-semibold">{title}</h1>
            )}
          </div>
          <form
            role="search"
            className="relative hidden w-72 md:block"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({
                to: "/tickets",
                search: { q: q || undefined, view: undefined },
              });
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="global-search" className="sr-only">
              Search tickets
            </label>
            <input
              id="global-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tickets, IDs, requesters…"
              className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm placeholder:text-muted-foreground"
            />
          </form>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Recent ticket activity, ${recentUpdates.length} updates`}
                className="relative"
              >
                <Bell />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
              {recentUpdates.length ? (
                recentUpdates.map((update) => (
                  <div
                    key={`${update.ticketId}-${update.id}`}
                    className="border-b px-3 py-2.5 last:border-0"
                  >
                    <div className="text-sm">{update.text}</div>
                    <div className="text-xs text-muted-foreground">
                      {update.ticketId} · {ago(update.at)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No ticket activity yet.
                </p>
              )}
            </PopoverContent>
          </Popover>
          {actions}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> <span className="hidden sm:inline">Create ticket</span>
          </Button>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>Log a request on behalf of an employee.</DialogDescription>
          </DialogHeader>
          <IntakeForm compact onDone={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

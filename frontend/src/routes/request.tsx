import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { IntakeForm } from "@/components/intake-form";
import { Avatar } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/request")({ component: RequesterPortal });

function RequesterPortal() {
  const { user, authLoading, signOut, allTickets, workspace, setWorkspace } = useStore();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/login" });
    if (!authLoading && user && user.role !== "requester") void navigate({ to: "/" });
  }, [authLoading, user, navigate]);

  async function leave() {
    setSigningOut(true);
    try {
      await signOut();
      await navigate({ to: "/login" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign out.");
    } finally {
      setSigningOut(false);
    }
  }

  if (authLoading || !user || user.role !== "requester") {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading your account…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-primary">SUPPORTPILOT</p>
            <h1 className="mt-1 text-lg font-semibold">My support requests</h1>
          </div>
          <div className="flex items-center gap-3">
            <Avatar
              initials={user.display_name
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            />
            <div className="hidden text-sm sm:block">
              <p className="font-medium">{user.display_name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void leave()} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Submit a support ticket</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">
            Describe the issue and choose the helpdesk that can assist you.
          </p>
          <div className="mb-5 max-w-sm space-y-1.5">
            <Label htmlFor="request-workspace">Helpdesk</Label>
            <select
              id="request-workspace"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value as typeof workspace)}
            >
              <option>IT Service Desk</option>
              <option>Facilities Helpdesk</option>
            </select>
          </div>
          <IntakeForm />
        </section>
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">Your submitted tickets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only tickets linked to your account appear here.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{allTickets.length}</span>
          </div>
          {allTickets.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              You have not submitted any tickets yet.
            </div>
          ) : (
            <ul className="divide-y">
              {allTickets.map((ticket) => (
                <li key={ticket.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{ticket.subject}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ticket.id} · {ticket.workspace} · {ticket.category}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs capitalize">
                      {ticket.status}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                    {ticket.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>Type: {ticket.ticketType}</span>
                    <span>Priority: {ticket.priority}</span>
                    <span>Severity: {ticket.severity}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

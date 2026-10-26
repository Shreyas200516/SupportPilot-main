import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  currentTime,
  type Activity,
  type Agent,
  type Message,
  type Ticket,
  type Workspace,
} from "./data";
import {
  apiTicketToUi,
  createApiTicket,
  getCurrentUser,
  listApiTickets,
  listSupportAgents,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUpRequester,
  type AuthUser,
  type TicketIntakeInput,
} from "./api";

interface Store {
  tickets: Ticket[];
  allTickets: Ticket[];
  agents: Agent[];
  ticketsLoading: boolean;
  ticketsError: string | null;
  getTicket: (id: string) => Ticket | undefined;
  updateTicket: (
    id: string,
    patch: Partial<Ticket>,
    activity?: Omit<Activity, "id" | "at" | "actor"> & { actor?: string },
  ) => void;
  bulkUpdate: (ids: string[], patch: Partial<Ticket>, text: string) => void;
  addMessage: (id: string, msg: Omit<Message, "id" | "at" | "author">) => void;
  createTicket: (t: Omit<Ticket, "id">, input: TicketIntakeInput) => Promise<string>;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  createOpen: boolean;
  setCreateOpen: (v: boolean) => void;
  user: AuthUser | null;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, name: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
let seq = 0;
const uid = () => `x${Date.now().toString(36)}${seq++}`;
export const nowIso = () => currentTime().toISOString();

export function StoreProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspace, setWorkspaceState] = useState<Workspace>("IT Service Desk");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("supportpilot:workspace");
    if (saved === "IT Service Desk" || saved === "Facilities Helpdesk") setWorkspaceState(saved);
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user) {
      setTickets([]);
      setTicketsLoading(false);
      setTicketsError(null);
      return () => {
        active = false;
      };
    }
    setTickets([]);
    setTicketsLoading(true);
    setTicketsError(null);
    listApiTickets()
      .then((items) => {
        if (!active) return;
        const saved = items.map((item) => apiTicketToUi(item));
        setTickets(saved);
      })
      .catch((error: unknown) => {
        if (active) {
          setTicketsError(error instanceof Error ? error.message : "Tickets could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setTicketsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!user || user.role === "requester") {
      setAgents([]);
      return () => {
        active = false;
      };
    }
    listSupportAgents()
      .then((items) => {
        if (!active) return;
        const loaded = items.flatMap((agent) => {
          const workspaces: Workspace[] =
            agent.workspace_scope === "all" || agent.workspace_scope === null
              ? ["IT Service Desk", "Facilities Helpdesk"]
              : [agent.workspace_scope];
          return workspaces.map((agentWorkspace) => ({
            id: String(agent.user_id),
            name: agent.display_name,
            initials: agent.display_name
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
            workspace: agentWorkspace,
          }));
        });
        setAgents(loaded);
      })
      .catch(() => {
        if (active) setAgents([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const setWorkspace = useCallback((next: Workspace) => {
    setWorkspaceState(next);
    localStorage.setItem("supportpilot:workspace", next);
  }, []);

  useEffect(() => {
    if (user?.role === "support_agent" && user.workspace_scope && user.workspace_scope !== "all") {
      setWorkspace(user.workspace_scope);
    }
  }, [user, setWorkspace]);

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await apiSignIn(email, password);
    setUser(signedIn);
    return signedIn;
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const registered = await signUpRequester(email, name, password);
    setUser(registered);
    return registered;
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setUser(null);
    setTickets([]);
    setTicketsError(null);
  }, []);

  const updateTicket: Store["updateTicket"] = useCallback(
    (id, patch, act) => {
      setTickets((ts) =>
        ts.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                activity: act
                  ? [
                      ...t.activity,
                      {
                        id: uid(),
                        at: nowIso(),
                        actor: act.actor ?? user?.display_name ?? "Support team",
                        kind: act.kind,
                        text: act.text,
                      },
                    ]
                  : t.activity,
              }
            : t,
        ),
      );
    },
    [user],
  );

  const bulkUpdate: Store["bulkUpdate"] = useCallback(
    (ids, patch, text) => {
      setTickets((ts) =>
        ts.map((t) =>
          ids.includes(t.id)
            ? {
                ...t,
                ...patch,
                activity: [
                  ...t.activity,
                  {
                    id: uid(),
                    at: nowIso(),
                    actor: user?.display_name ?? "Support team",
                    kind: "agent",
                    text: `${text} (bulk action)`,
                  },
                ],
              }
            : t,
        ),
      );
    },
    [user],
  );

  const addMessage: Store["addMessage"] = useCallback(
    (id, msg) => {
      setTickets((ts) =>
        ts.map((t) =>
          t.id === id
            ? {
                ...t,
                firstResponseMin: t.firstResponseMin ?? (msg.kind === "agent" ? 12 : null),
                messages: [
                  ...t.messages,
                  { ...msg, id: uid(), at: nowIso(), author: user?.display_name ?? "Support team" },
                ],
                activity: [
                  ...t.activity,
                  {
                    id: uid(),
                    at: nowIso(),
                    actor: user?.display_name ?? "Support team",
                    kind: "agent",
                    text: msg.kind === "note" ? "Added internal note" : "Sent reply to requester",
                  },
                ],
              }
            : t,
        ),
      );
    },
    [user],
  );

  const createTicket: Store["createTicket"] = useCallback(async (t, input) => {
    const saved = await createApiTicket(input);
    const ticket = apiTicketToUi(saved, { ...t, workspace: input.workspace });
    setTickets((ts) => [ticket, ...ts.filter((existing) => existing.id !== ticket.id)]);
    setTicketsError(null);
    return ticket.id;
  }, []);

  const visibleTickets = useMemo(
    () => tickets.filter((ticket) => (ticket.workspace ?? "IT Service Desk") === workspace),
    [tickets, workspace],
  );

  const value = useMemo<Store>(
    () => ({
      tickets: visibleTickets,
      allTickets: tickets,
      agents,
      ticketsLoading,
      ticketsError,
      getTicket: (id) => tickets.find((t) => t.id === id),
      updateTicket,
      bulkUpdate,
      addMessage,
      createTicket,
      createOpen,
      setCreateOpen,
      workspace,
      setWorkspace,
      user,
      authLoading,
      signIn,
      register,
      signOut,
    }),
    [
      tickets,
      agents,
      ticketsLoading,
      ticketsError,
      visibleTickets,
      updateTicket,
      bulkUpdate,
      addMessage,
      createTicket,
      createOpen,
      workspace,
      setWorkspace,
      user,
      authLoading,
      signIn,
      register,
      signOut,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used within StoreProvider");
  return s;
}

export function slaState(t: Ticket): "met" | "overdue" | "at-risk" | "on-track" {
  if (t.status === "resolved") return "met";
  const mins = (new Date(t.slaDue).getTime() - currentTime().getTime()) / 60000;
  if (mins < 0) return "overdue";
  if (mins < 120) return "at-risk";
  return "on-track";
}

export function slaLabel(t: Ticket) {
  if (t.status === "resolved") return "Met";
  const mins = Math.round((new Date(t.slaDue).getTime() - currentTime().getTime()) / 60000);
  const abs = Math.abs(mins);
  const s = abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs}m`;
  return mins < 0 ? `${s} overdue` : `${s} left`;
}

export function ago(iso: string) {
  const mins = Math.round((currentTime().getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

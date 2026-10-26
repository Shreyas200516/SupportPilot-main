import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/login")({ component: SignInPage });

function SignInPage() {
  const { user, authLoading, signIn, register } = useStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      void navigate({ to: user.role === "requester" ? "/request" : "/" });
    }
  }, [authLoading, user, navigate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const account =
        mode === "signin" ? await signIn(email, password) : await register(email, name, password);
      await navigate({ to: account.role === "requester" ? "/request" : "/" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm">
        <Link to="/login" className="text-sm font-semibold tracking-wide text-primary">
          SUPPORTPILOT
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">
          {mode === "signin" ? "Sign in" : "Create a requester account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to submit or manage support tickets."
            : "Requester accounts can submit tickets and view their own requests."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div className="space-y-1.5">
              <Label htmlFor="display-name">Name</Label>
              <Input
                id="display-name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "register" ? 12 : 1}
              maxLength={256}
            />
            {mode === "register" && (
              <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy || authLoading}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create requester account"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "Need an account? " : "Already have an account? "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setError("");
              setMode(mode === "signin" ? "register" : "signin");
            }}
          >
            {mode === "signin" ? "Create a requester account" : "Sign in"}
          </button>
        </p>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Support staff accounts are created by an administrator.
        </p>
      </section>
    </main>
  );
}

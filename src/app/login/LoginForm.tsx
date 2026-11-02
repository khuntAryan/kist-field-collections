"use client";
import { useState } from "react";
import { Banner, Button, cx } from "@/components/ui";

type Account = { email: string; name: string; role: string; note: string };

export function LoginForm({ demoAccounts, demoPassword }: { demoAccounts: Account[]; demoPassword: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: string, p: string, who: string) {
    setBusy(who);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e, password: p }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message ?? "Could not sign in. Try again.");
        setBusy(null);
        return;
      }
      window.location.href = body.redirect;
    } catch {
      setError("No connection. Signing in needs the internet once; after that the officer app works offline.");
      setBusy(null);
    }
  }

  const emailInvalid = email.length > 0 && !/^\S+@\S+\.\S+$/.test(email);

  return (
    <>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!emailInvalid && email && password) signIn(email.trim(), password, "form");
        }}
        noValidate
      >
        <label className="block">
          <span className="text-sm font-semibold">Email</span>
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailInvalid || undefined}
            className={cx(
              "mt-1 h-12 w-full rounded-[var(--radius-control)] border bg-surface px-3 outline-none focus:border-accent",
              emailInvalid ? "border-late" : "border-rule-strong",
            )}
          />
          {emailInvalid && <span className="mt-1 block text-sm text-late">Enter an email like name@company.in</span>}
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-12 w-full rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3 outline-none focus:border-accent"
          />
        </label>
        {error && <Banner tone="late">{error}</Banner>}
        <Button type="submit" size="lg" className="w-full" busy={busy === "form"} disabled={!email || !password || emailInvalid || busy !== null}>
          Sign in
        </Button>
      </form>

      {demoAccounts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-ink-2">Demo accounts</h2>
          <p className="text-sm text-ink-3">Sample data only. One tap signs you in.</p>
          <ul className="mt-3 divide-y divide-rule rounded-[var(--radius-control)] border border-rule bg-surface">
            {demoAccounts.map((a) => (
              <li key={a.email}>
                <button
                  onClick={() => signIn(a.email, demoPassword, a.email)}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper disabled:opacity-60"
                >
                  <span>
                    <span className="block font-semibold">{a.name}</span>
                    <span className="block text-sm text-ink-2">{a.role}</span>
                  </span>
                  <span className="text-right text-2xs text-ink-3">{busy === a.email ? "Signing in…" : a.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

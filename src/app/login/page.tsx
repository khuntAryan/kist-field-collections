import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/server/auth/session";
import { demoMode } from "@/server/clock";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const DEMO_ACCOUNTS = [
  { email: "rahul@kist.test", name: "Rahul Chouhan", role: "Field officer, Indore City", note: "Phone app, in Hindi" },
  { email: "sanjay@kist.test", name: "Sanjay Jain", role: "Branch manager, Indore City", note: "Import, lists, roll rates" },
  { email: "ritu@kist.test", name: "Ritu Agrawal", role: "Head of collections", note: "All three branches" },
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  const demo = demoMode();
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-rule bg-surface lg:block">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 55px, var(--color-rule) 55px, var(--color-rule) 56px)" }}
        />
        <div aria-hidden className="absolute inset-y-0 left-24 w-px bg-late/25" />
        <div className="relative flex h-full flex-col justify-between py-14 pr-12 pl-32">
          <p className="text-sm text-ink-2">Company A, Indore</p>
          <div>
            <p className="figure text-[7.5rem] leading-[0.85] font-semibold text-accent">Kist</p>
            <p className="mt-2 text-[2.2rem] leading-none font-medium text-ink-2">किस्त</p>
            <p className="mt-8 max-w-md text-xl leading-snug text-ink">
              Each field officer starts the day with a short, ordered list of borrowers and the reasons behind it. Every visit is logged, even with no signal.
            </p>
          </div>
          <ol className="max-w-md space-y-[1.05rem] text-ink-2">
            {["Company D, promise broken two days ago", "Company C, crosses 31 DPD in 4 days", "Company B, promised to pay this week"].map((line, i) => (
              <li key={line} className="flex items-baseline gap-4">
                <span className="figure w-5 text-right text-2xl font-semibold text-accent">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="figure text-6xl leading-none font-semibold text-accent">Kist</p>
            <p className="mt-1 text-ink-2">Field collections for Company A</p>
          </div>
          <h1 className="text-2xl font-semibold narrow">Sign in</h1>
          <p className="mt-1 text-ink-2">Use the email your branch gave you.</p>
          <LoginForm demoAccounts={demo ? DEMO_ACCOUNTS : []} demoPassword={demo ? (process.env.DEMO_PASSWORD ?? "") : ""} />
        </div>
      </section>
    </main>
  );
}

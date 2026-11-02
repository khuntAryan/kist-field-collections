"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, CalendarClock, FileSpreadsheet, LayoutDashboard, ListOrdered, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/manage", label: "Overview", icon: LayoutDashboard },
  { href: "/manage/import", label: "Daily import", icon: FileSpreadsheet },
  { href: "/manage/lists", label: "Officer lists", icon: ListOrdered },
  { href: "/manage/promises", label: "Promises", icon: CalendarClock },
  { href: "/manage/model", label: "Score check", icon: ShieldCheck },
  { href: "/manage/activity", label: "Activity log", icon: Activity },
];

export function ManageShell({
  user,
  branches,
  scope,
  unassigned,
  children,
}: {
  user: { name: string; role: "manager" | "head"; branchName: string };
  branches: { id: string; name: string }[];
  scope: string | null;
  unassigned: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  async function switchBranch(branch: string) {
    setSwitching(true);
    await fetch("/api/manage/branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch }) });
    router.refresh();
    setSwitching(false);
  }
  async function signOut() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    const body = await res.json().catch(() => ({ redirect: "/login" }));
    window.location.href = body.redirect ?? "/login";
  }

  const nav = (
    <nav aria-label="Manager" className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-5">
        <Link href="/manage" className="figure text-4xl leading-none font-semibold text-accent">
          Kist
        </Link>
        <p className="mt-1 text-sm text-ink-2">{user.role === "head" ? "Head of collections" : `${user.branchName} branch`}</p>
      </div>
      {user.role === "head" && (
        <div className="px-5 pb-4">
          <label className="text-2xs font-semibold text-ink-2" htmlFor="branch-pick">
            Showing
          </label>
          <select
            id="branch-pick"
            value={scope ?? "all"}
            disabled={switching}
            onChange={(e) => switchBranch(e.target.value)}
            className="mt-1 h-10 w-full rounded-[var(--radius-control)] border border-rule-strong bg-surface px-2.5 text-sm font-semibold"
          >
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/manage" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[0.95rem]",
                  active ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-paper hover:text-ink",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
                <span className="flex-1">{label}</span>
                {href === "/manage/lists" && unassigned > 0 && (
                  <span className="figure rounded-full bg-due px-1.5 text-xs font-semibold text-white" title={`${unassigned} unassigned`}>
                    {unassigned}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-rule px-5 py-4">
        <p className="truncate font-semibold">{user.name}</p>
        <button onClick={signOut} className="mt-1 inline-flex h-9 items-center gap-2 text-sm text-ink-2 hover:text-ink">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-rule bg-surface lg:block">{nav}</aside>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-rule bg-surface px-4 lg:hidden">
        <Link href="/manage" className="figure text-3xl leading-none font-semibold text-accent">
          Kist
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="grid size-11 place-items-center rounded-full hover:bg-paper">
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="animate-fade absolute inset-0 bg-ink/35" />
          <div className="animate-fade absolute inset-y-0 left-0 w-[82%] max-w-xs bg-surface shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-3 right-3 grid size-11 place-items-center rounded-full hover:bg-paper">
              <X className="size-5" />
            </button>
            {nav}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 pt-6 pb-16 sm:px-8 lg:px-10">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[1.9rem] leading-tight font-semibold narrow">{title}</h1>
        {description && <p className="mt-1 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

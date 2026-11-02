"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, RotateCcw, TriangleAlert } from "lucide-react";
import { Banner, Chip, EmptyState, cx, dpdTone } from "@/components/ui";
import { formatCompactINR } from "@/lib/format";
import { reasonText } from "@/lib/i18n";
import { formatShortDate } from "@/lib/time";
import type { ListLoan } from "@/server/queries/manage";

type Officer = {
  id: string;
  name: string;
  branchId: string | null;
  maxLoad: number;
  assigned: number;
  contactedToday: number;
  loans: ListLoan[];
};

const OUTCOME: Record<string, { label: string; tone: "ok" | "accent" | "neutral" | "late" }> = {
  paid: { label: "Paid today", tone: "ok" },
  promise: { label: "Promised today", tone: "accent" },
  not_reachable: { label: "Not reachable today", tone: "neutral" },
  dispute: { label: "Dispute today", tone: "late" },
};
const ASSIGN: Record<string, string> = {
  kept_with_officer: "Kept with officer",
  pincode_match: "Pincode match",
  branch_fallback: "No pincode match, branch officer",
  manual: "Assigned by manager",
};

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-md border border-rule text-ink-2 hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-rule disabled:hover:text-ink-2"
    >
      {children}
    </button>
  );
}

export function ListsBoard({ officers, unassigned, selectedId }: { officers: Officer[]; unassigned: ListLoan[]; selectedId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyLoan, setBusyLoan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(selectedId && officers.some((o) => o.id === selectedId) ? selectedId : (officers[0]?.id ?? null));
  const officer = officers.find((o) => o.id === selected);

  async function call(url: string, body: unknown, loanId: string) {
    setBusyLoan(loanId);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "That change did not save. Try again.");
      startTransition(() => router.refresh());
    } catch {
      setError("No connection. The change was not saved.");
    } finally {
      setBusyLoan(null);
    }
  }
  const move = (loanId: string, action: "top" | "up" | "down" | "reset") => call("/api/manage/lists/order", { loanId, action }, loanId);
  const assign = (loanId: string, officerId: string) => call(`/api/manage/loans/${loanId}/assign`, { officerId }, loanId);

  if (officers.length === 0) return <EmptyState title="No field officers" body="Add officers to this branch to build lists." />;

  return (
    <div className={cx("space-y-5", pending && "opacity-70 transition-opacity")}>
      {error && <Banner tone="late" icon={<TriangleAlert className="size-4" />}>{error}</Banner>}

      {unassigned.length > 0 && (
        <section className="rounded-[var(--radius-control)] border border-due/30 bg-surface">
          <div className="border-b border-rule px-4 py-3">
            <h2 className="font-semibold">Waiting for an officer ({unassigned.length})</h2>
            <p className="text-sm text-ink-2">Every officer who covers these pincodes is at their maximum list size. Pick someone in the branch.</p>
          </div>
          <ul>
            {unassigned.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3 last:border-0">
                <Link href={`/manage/loans/${l.id}`} className="min-w-40 flex-1 font-semibold hover:text-accent hover:underline">
                  {l.name} <span className="text-sm font-normal text-ink-3">{l.id}, {l.pincode}</span>
                </Link>
                <Chip tone={dpdTone(l.dpd)}>{l.dpd} DPD</Chip>
                <span className="figure w-20 text-right text-lg">{formatCompactINR(l.overdue)}</span>
                <select
                  aria-label={`Assign ${l.name}`}
                  defaultValue=""
                  disabled={busyLoan === l.id}
                  onChange={(e) => e.target.value && assign(l.id, e.target.value)}
                  className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-2 text-sm"
                >
                  <option value="" disabled>
                    Assign to…
                  </option>
                  {officers
                    .filter((o) => o.branchId === l.branchId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.assigned}/{o.maxLoad})
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
        <nav aria-label="Officers">
          <label className="lg:hidden">
            <span className="text-sm font-semibold">Officer</span>
            <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="mt-1 h-11 w-full rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3">
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}, {o.assigned} loans
                </option>
              ))}
            </select>
          </label>
          <ul className="hidden overflow-hidden rounded-[var(--radius-control)] border border-rule bg-surface lg:block">
            {officers.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => setSelected(o.id)}
                  aria-current={o.id === selected ? "true" : undefined}
                  className={cx("flex w-full items-center justify-between border-b border-rule px-4 py-3 text-left last:border-0", o.id === selected ? "bg-accent-soft" : "hover:bg-paper")}
                >
                  <span>
                    <span className={cx("block font-semibold", o.id === selected && "text-accent")}>{o.name}</span>
                    <span className="text-sm text-ink-2">
                      {o.contactedToday} contacted today{o.branchId ? `, ${o.branchId}` : ""}
                    </span>
                  </span>
                  <span className="figure text-lg">
                    {o.assigned}
                    <span className="text-sm text-ink-3">/{o.maxLoad}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {officer && (
          <section aria-label={`${officer.name}'s list`} className="min-w-0">
            {officer.loans.length === 0 ? (
              <EmptyState title={`${officer.name} has no loans today`} body="New overdue loans in their pincodes will be assigned at the next import." />
            ) : (
              <ol className="overflow-hidden rounded-[var(--radius-control)] border border-rule bg-surface">
                {officer.loans.map((l, i) => (
                  <li key={l.id} className={cx("grid grid-cols-[2.25rem_1fr] gap-x-3 border-b border-rule px-4 py-3.5 last:border-0", busyLoan === l.id && "opacity-60")}>
                    <span className="figure pt-0.5 text-right text-[1.6rem] leading-none font-semibold text-accent">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <Link href={`/manage/loans/${l.id}`} className="font-semibold hover:text-accent hover:underline">
                          {l.name} <span className="text-sm font-normal text-ink-3">{l.id}</span>
                        </Link>
                        <span className="flex items-baseline gap-3">
                          <span className="text-sm text-ink-2">Score</span>
                          <span className="figure text-xl font-semibold">{l.score}</span>
                          <span className="figure w-20 text-right text-xl font-semibold">{formatCompactINR(l.overdue)}</span>
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
                        <span>{l.businessType}</span>
                        <Chip tone={dpdTone(l.dpd)}>{l.dpd} DPD</Chip>
                        {l.promise && (
                          <Chip tone={l.promise.status === "broken" ? "late" : "accent"}>
                            {l.promise.status === "broken" ? "Promise broken" : "Promise"} {formatShortDate(l.promise.date)}
                          </Chip>
                        )}
                        {l.todayOutcome && <Chip tone={OUTCOME[l.todayOutcome]?.tone}>{OUTCOME[l.todayOutcome]?.label}</Chip>}
                        {l.manualRank !== null && <Chip tone="accent">Moved by manager</Chip>}
                        {l.disputed && <Chip tone="late">Dispute</Chip>}
                        {l.limitedHistory && <Chip>Little history</Chip>}
                      </div>
                      {l.reasons.length > 0 && (
                        <p className="mt-1.5 text-sm">
                          {l.reasons.map((r, k) => (
                            <span key={r.key} className="inline-flex items-center gap-1 pr-3">
                              {r.effect > 0 ? <ArrowUp className="size-3.5 text-late" aria-label="raises" /> : <ArrowDown className="size-3.5 text-ok" aria-label="lowers" />}
                              {reasonText(r, "en")}
                              {k < l.reasons.length - 1 && <span className="sr-only">;</span>}
                            </span>
                          ))}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <IconButton label={`Move ${l.name} to the top`} onClick={() => move(l.id, "top")} disabled={i === 0 || !!busyLoan}>
                          <ArrowUpToLine className="size-4" />
                        </IconButton>
                        <IconButton label={`Move ${l.name} up`} onClick={() => move(l.id, "up")} disabled={i === 0 || !!busyLoan}>
                          <ArrowUp className="size-4" />
                        </IconButton>
                        <IconButton label={`Move ${l.name} down`} onClick={() => move(l.id, "down")} disabled={i === officer.loans.length - 1 || !!busyLoan}>
                          <ArrowDown className="size-4" />
                        </IconButton>
                        {l.manualRank !== null && (
                          <button onClick={() => move(l.id, "reset")} disabled={!!busyLoan} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-accent hover:bg-accent-soft">
                            <RotateCcw className="size-3.5" /> Back to score order
                          </button>
                        )}
                        <span className="ml-auto flex items-center gap-2 text-2xs text-ink-3">
                          {ASSIGN[l.assignmentReason ?? ""] ?? ""}
                          <select
                            aria-label={`Reassign ${l.name}`}
                            value=""
                            disabled={!!busyLoan}
                            onChange={(e) => e.target.value && assign(l.id, e.target.value)}
                            className="h-9 rounded-md border border-rule bg-surface px-1.5 text-sm text-ink"
                          >
                            <option value="">Reassign…</option>
                            {officers
                              .filter((o) => o.id !== officer.id && o.branchId === officer.branchId)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name} ({o.assigned}/{o.maxLoad})
                                </option>
                              ))}
                          </select>
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

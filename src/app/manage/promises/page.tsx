import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getPromiseTracker } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { Chip, dpdTone } from "@/components/ui";
import { formatINR } from "@/lib/format";
import { daysBetween, formatShortDate } from "@/lib/time";

export const metadata: Metadata = { title: "Promises" };
export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof getPromiseTracker>>["broken"][number];

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function Table({ rows, today, empty, showDays }: { rows: Row[]; today: string; empty: string; showDays?: "late" | "ahead" }) {
  if (rows.length === 0) return <p className="rounded-[var(--radius-control)] border border-dashed border-rule-strong px-4 py-5 text-ink-2">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
      <table className="w-full min-w-[720px] text-left text-[0.95rem]">
        <thead className="text-sm text-ink-2">
          <tr className="border-b border-rule">
            <th className="px-4 py-2.5 font-medium">Borrower</th>
            <th className="px-4 py-2.5 font-medium">Officer</th>
            <th className="px-4 py-2.5 text-right font-medium">Amount</th>
            <th className="px-4 py-2.5 font-medium">Promised for</th>
            <th className="px-4 py-2.5 font-medium">Now</th>
            <th className="px-4 py-2.5 font-medium">Reminder</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-rule last:border-0">
              <td className="px-4 py-3">
                <Link href={`/manage/loans/${r.loanId}`} className="font-semibold hover:text-accent hover:underline">
                  {r.borrower}
                </Link>
                <span className="ml-2 text-sm text-ink-3">{r.loanId}</span>
              </td>
              <td className="px-4 py-3 text-ink-2">{r.officer}</td>
              <td className="figure px-4 py-3 text-right text-lg">{formatINR(r.amount)}</td>
              <td className="px-4 py-3">
                {formatShortDate(r.date)}
                {showDays === "late" && <span className="ml-2 text-sm text-late">{dayCount(daysBetween(r.date, today))} ago</span>}
                {showDays === "ahead" && <span className="ml-2 text-sm text-ink-3">in {dayCount(daysBetween(today, r.date))}</span>}
              </td>
              <td className="px-4 py-3">{r.loanStatus === "overdue" ? <Chip tone={dpdTone(r.dpd)}>{r.dpd} DPD</Chip> : <Chip tone="ok">Paid up</Chip>}</td>
              <td className="px-4 py-3 text-sm text-ink-2">{r.reminded ? "Sent" : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PromisesPage() {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const t = await getPromiseTracker(scope, await now());
  const keptRate = t.kept.length + t.broken.length ? t.kept.length / (t.kept.length + t.broken.length) : null;
  return (
    <>
      <PageHeader
        title="Promises to pay"
        description="Every promise officers logged in the last 14 days. A promise is kept when payments reach 90% of the amount by the promised date."
      />
      <section className="mb-8 grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-rule bg-rule sm:grid-cols-4">
        {[
          ["Due today", t.dueToday.length],
          ["Upcoming", t.upcoming.length],
          ["Broken, 14 days", t.broken.length],
          ["Kept rate, 14 days", keptRate === null ? "–" : `${Math.round(keptRate * 100)}%`],
        ].map(([l, v]) => (
          <div key={l} className="bg-surface px-5 py-4">
            <p className="text-sm text-ink-2">{l}</p>
            <p className="figure text-[2.3rem] leading-tight font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="space-y-8">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Due today</h2>
          <Table rows={t.dueToday} today={t.today} empty="No promises fall due today." />
        </section>
        {t.overdueOpen.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-semibold">Date passed, waiting for tomorrow&rsquo;s file</h2>
            <p className="mb-2 text-sm text-ink-2">These are settled as kept or broken when the next overdue file shows whether the payment arrived.</p>
            <Table rows={t.overdueOpen} today={t.today} empty="" showDays="late" />
          </section>
        )}
        <section>
          <h2 className="mb-2 text-lg font-semibold">Broken</h2>
          <Table rows={t.broken} today={t.today} empty="No broken promises in the last 14 days." showDays="late" />
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold">Upcoming</h2>
          <Table rows={t.upcoming} today={t.today} empty="No upcoming promises." showDays="ahead" />
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold">By officer, last 14 days</h2>
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
            <table className="w-full min-w-[420px] text-left text-[0.95rem]">
              <thead className="text-sm text-ink-2">
                <tr className="border-b border-rule">
                  <th className="px-4 py-2.5 font-medium">Officer</th>
                  <th className="px-4 py-2.5 text-right font-medium">Kept</th>
                  <th className="px-4 py-2.5 text-right font-medium">Broken</th>
                  <th className="px-4 py-2.5 text-right font-medium">Kept rate</th>
                </tr>
              </thead>
              <tbody>
                {t.byOfficer.map((o) => (
                  <tr key={o.name} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 font-semibold">{o.name}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{o.kept}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{o.broken}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{Math.round((o.kept / Math.max(1, o.kept + o.broken)) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

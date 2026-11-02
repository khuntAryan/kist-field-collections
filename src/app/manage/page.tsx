import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getOverview } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { RollRateChart, BRANCH_COLORS } from "@/components/manage/RollRateChart";
import { Banner, Chip, EmptyState, cx } from "@/components/ui";
import { formatCompactINR, formatPercent } from "@/lib/format";
import { formatISTTime, formatShortDate, istDate } from "@/lib/time";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const TARGET = 0.16;
const BASELINE = 0.22;

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "late" | "ok" }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cx("figure mt-0.5 text-[2.5rem] leading-none font-semibold", tone === "late" && "text-late")}>{value}</p>
      {sub && <div className="mt-1.5 text-sm text-ink-2">{sub}</div>}
    </div>
  );
}

function since(d: Date | null, at: Date) {
  if (!d) return "No entries this week";
  const mins = Math.round((at.getTime() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  if (istDate(d) === istDate(at)) return formatISTTime(d);
  return formatShortDate(istDate(d));
}

export default async function OverviewPage() {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const at = await now();
  const o = await getOverview(scope, at);
  const k = o.kpi;
  const rr = k.rollRate?.rate ?? null;
  const prev = k.rollRatePrev?.rate ?? null;
  const delta = rr !== null && prev !== null ? (rr - prev) * 100 : null;
  const title = scope ? (o.branches[0]?.name ?? "Branch") : "All branches";

  return (
    <>
      <PageHeader
        title={title}
        description={`Roll rates and field activity, from the ${formatShortDate(o.fileDate)} overdue file.`}
        actions={
          o.fileDate < o.today ? (
            <Link href="/manage/import" className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 font-semibold text-white hover:bg-accent-strong">
              Import today&rsquo;s file
            </Link>
          ) : null
        }
      />

      {o.fileDate < o.today && (
        <div className="mb-5">
          <Banner tone="due" icon={<CalendarClock className="size-4" />}>
            Officers are working from the {formatShortDate(o.fileDate)} list. Import today&rsquo;s overdue file to refresh priorities.
          </Banner>
        </div>
      )}
      {k.unassigned > 0 && (
        <div className="mb-5">
          <Banner tone="due" icon={<TriangleAlert className="size-4" />} action={<Link href="/manage/lists" className="font-semibold underline">Assign</Link>}>
            {k.unassigned} overdue {k.unassigned === 1 ? "loan has" : "loans have"} no officer. Every officer who covers that pincode is full.
          </Banner>
        </div>
      )}

      {k.overdueLoans === 0 && o.trend.length === 0 ? (
        <EmptyState title="No overdue loans yet" body="Import the morning overdue file to build today's lists." action={<Link className="font-semibold text-accent underline" href="/manage/import">Go to daily import</Link>} />
      ) : (
        <>
          <section aria-label="Key numbers" className="grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Roll rate, last 30 days"
              value={formatPercent(rr)}
              tone={rr !== null && rr > TARGET ? "late" : undefined}
              sub={
                <span className="flex flex-wrap items-center gap-x-2">
                  <span>Target {Math.round(TARGET * 100)}%, was {Math.round(BASELINE * 100)}%</span>
                  {delta !== null && <Chip tone={delta > 0 ? "late" : "ok"}>{`${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts vs last week`}</Chip>}
                </span>
              }
            />
            <Stat label="Promises broken, last 7 days" value={k.brokenWeek} sub={`${k.keptWeek} kept, ${k.dueToday} due today`} />
            <Stat label="Contacts logged today" value={k.visitsToday} sub={`${formatPercent(k.sameDayRate, 0)} synced the same day (7 days, target 95%)`} />
            <Stat label="Overdue loans" value={k.overdueLoans} sub={`${formatCompactINR(k.overdueAmount)} in missed EMIs, ${formatCompactINR(k.outstanding)} outstanding`} />
          </section>

          <section className="mt-8 rounded-[var(--radius-control)] border border-rule bg-surface p-5">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Roll rate by branch</h2>
              <p className="text-sm text-ink-2">Share of loans at 1–30 DPD that were 31+ DPD thirty days later. One point per week.</p>
            </div>
            <RollRateChart points={o.trend} branches={o.branches.map((b) => ({ id: b.id, name: b.name }))} target={TARGET} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-accent">Show the numbers as a table</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead className="text-ink-2">
                    <tr className="border-b border-rule">
                      <th className="py-2 pr-3 font-medium">30 days to</th>
                      {o.branches.map((b) => (
                        <th key={b.id} className="py-2 pr-3 font-medium">
                          {b.name}
                        </th>
                      ))}
                      <th className="py-2 font-medium">All</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.trend.map((p) => (
                      <tr key={p.endDate} className="border-b border-rule last:border-0">
                        <td className="py-1.5 pr-3">{formatShortDate(p.endDate)}</td>
                        {o.branches.map((b) => (
                          <td key={b.id} className="figure py-1.5 pr-3 text-base">
                            {formatPercent(p.byBranch[b.id]?.rate ?? null)} <span className="text-ink-3">({p.byBranch[b.id]?.rolled ?? 0}/{p.byBranch[b.id]?.cohort ?? 0})</span>
                          </td>
                        ))}
                        <td className="figure py-1.5 text-base font-semibold">{formatPercent(p.overall.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {o.byBranch.length > 1 && (
            <section className="mt-8">
              <h2 className="mb-2 text-lg font-semibold">Branches</h2>
              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
                <table className="w-full min-w-[760px] text-left text-[0.95rem]">
                  <thead className="text-sm text-ink-2">
                    <tr className="border-b border-rule">
                      <th className="px-4 py-2.5 font-medium">Branch</th>
                      <th className="px-4 py-2.5 text-right font-medium">Overdue loans</th>
                      <th className="px-4 py-2.5 text-right font-medium">Missed EMIs</th>
                      <th className="px-4 py-2.5 text-right font-medium">Roll rate</th>
                      <th className="px-4 py-2.5 text-right font-medium">Broken, 7 days</th>
                      <th className="px-4 py-2.5 text-right font-medium">Due today</th>
                      <th className="px-4 py-2.5 text-right font-medium">Contacts today</th>
                      <th className="px-4 py-2.5 text-right font-medium">Same-day sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.byBranch.map((b) => (
                      <tr key={b.id} className="border-b border-rule last:border-0">
                        <td className="px-4 py-3 font-semibold">
                          <span className="mr-2 inline-block h-[3px] w-4 rounded align-middle" style={{ background: BRANCH_COLORS[b.id] }} aria-hidden />
                          {b.name}
                        </td>
                        <td className="figure px-4 py-3 text-right text-lg">{b.loans}</td>
                        <td className="figure px-4 py-3 text-right text-lg">{formatCompactINR(b.overdue)}</td>
                        <td className={cx("figure px-4 py-3 text-right text-lg font-semibold", (b.rollRate?.rate ?? 0) > TARGET && "text-late")}>{formatPercent(b.rollRate?.rate ?? null)}</td>
                        <td className="figure px-4 py-3 text-right text-lg">{b.brokenWeek}</td>
                        <td className="figure px-4 py-3 text-right text-lg">{b.dueToday}</td>
                        <td className="figure px-4 py-3 text-right text-lg">{b.visitsToday}</td>
                        <td className="figure px-4 py-3 text-right text-lg">{formatPercent(b.sameDayRate, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-semibold">Officers</h2>
            <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
              <table className="w-full min-w-[860px] text-left text-[0.95rem]">
                <thead className="text-sm text-ink-2">
                  <tr className="border-b border-rule">
                    <th className="px-4 py-2.5 font-medium">Officer</th>
                    <th className="px-4 py-2.5 text-right font-medium">On list</th>
                    <th className="px-4 py-2.5 text-right font-medium">Contacted today</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid / promised today</th>
                    <th className="px-4 py-2.5 text-right font-medium">Broken, 7 days</th>
                    <th className="px-4 py-2.5 text-right font-medium">Same-day sync</th>
                    <th className="px-4 py-2.5 text-right font-medium">Blocked after hours</th>
                    <th className="px-4 py-2.5 font-medium">Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {o.officers.map((of) => (
                    <tr key={of.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3">
                        <Link href={`/manage/lists?officer=${of.id}`} className="font-semibold hover:text-accent hover:underline">
                          {of.name}
                        </Link>
                        {!scope && <span className="ml-2 text-sm text-ink-3">{of.branchId}</span>}
                      </td>
                      <td className="figure px-4 py-3 text-right text-lg">
                        {of.assigned}
                        <span className="text-sm text-ink-3">/{of.maxLoad}</span>
                      </td>
                      <td className="figure px-4 py-3 text-right text-lg">{of.contactedToday}</td>
                      <td className="figure px-4 py-3 text-right text-lg">
                        {of.paidToday} / {of.promiseToday}
                      </td>
                      <td className="figure px-4 py-3 text-right text-lg">{of.brokenWeek}</td>
                      <td className={cx("figure px-4 py-3 text-right text-lg", of.sameDayRate !== null && of.sameDayRate < 0.95 && "text-due")}>{formatPercent(of.sameDayRate, 0)}</td>
                      <td className="figure px-4 py-3 text-right text-lg">{of.blockedWeek || "–"}</td>
                      <td className="px-4 py-3 text-sm text-ink-2">{since(of.lastSync, at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm text-ink-3">
              Blocked after hours: calls or messages an officer tried outside 8 am to 7 pm. The app stopped them and recorded each one.
            </p>
          </section>
        </>
      )}
    </>
  );
}

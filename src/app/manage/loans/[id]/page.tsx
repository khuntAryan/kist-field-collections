import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, MapPin } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { getLoanDetail } from "@/server/queries/manage";
import { audit } from "@/server/audit";
import { Chip, dpdTone } from "@/components/ui";
import { ReassignControl } from "@/components/manage/ReassignControl";
import { formatCompactINR, formatINR, maskPhone } from "@/lib/format";
import { reasonText } from "@/lib/i18n";
import { formatISTTime, formatShortDate, istDate } from "@/lib/time";
import { overdueAmountOf } from "@/server/queries/officer";

export const metadata: Metadata = { title: "Borrower" };
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, string> = { paid: "Paid", promise: "Promise", not_reachable: "Not reachable", dispute: "Dispute" };

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const { id } = await params;
  if (!/^LN-\d{3,8}$/.test(id)) notFound();
  const d = await getLoanDetail(id, scope);
  if (!d) notFound();
  await audit(user, "loan.viewed", { type: "loan", id });

  const score = d.scores[0];
  const timeline = [
    ...d.outcomes.map((o) => ({ at: o.o.occurredAt, kind: "outcome" as const, o })),
    ...d.messages.map((m) => ({ at: m.occurredAt, kind: "message" as const, m })),
    ...d.attempts.filter((a) => !a.allowed).map((a) => ({ at: a.occurredAt, kind: "blocked" as const, a })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const dpdSeries = d.snapshots.slice(-60);
  const maxDpd = Math.max(40, ...dpdSeries.map((s) => s.dpd)) * 1.15;

  return (
    <>
      <Link href="/manage/lists" className="mb-4 inline-flex h-9 items-center gap-1 text-sm font-semibold text-accent hover:underline">
        <ChevronLeft className="size-4" /> Officer lists
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[1.9rem] leading-tight font-semibold narrow">{d.b.name}</h1>
          <p className="text-ink-2">
            {d.b.businessType}, {d.loan.id}, {d.loan.branchId}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={d.loan.status === "overdue" ? dpdTone(d.loan.dpd) : "ok"}>{d.loan.status === "overdue" ? `${d.loan.dpd} DPD` : d.loan.status === "cured" ? "Paid up" : "Closed"}</Chip>
            {d.loan.disputed && <Chip tone="late">Dispute raised</Chip>}
            {d.loan.manualRank !== null && <Chip tone="accent">Moved by manager</Chip>}
          </div>
        </div>
        {d.loan.status === "overdue" && <ReassignControl loanId={d.loan.id} current={d.loan.assignedOfficerId} officers={d.officers} officerName={d.officer} />}
      </div>

      <section className="mt-6 grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-rule bg-rule sm:grid-cols-4">
        {[
          ["Missed EMIs", formatINR(overdueAmountOf(d.loan.emi, d.loan.dpd))],
          ["EMI", formatINR(d.loan.emi)],
          ["Outstanding", formatCompactINR(d.loan.outstanding)],
          ["Last payment", d.loan.lastPaymentDate ? formatShortDate(d.loan.lastPaymentDate) : "–"],
        ].map(([l, v]) => (
          <div key={l} className="bg-surface px-5 py-4">
            <p className="text-sm text-ink-2">{l}</p>
            <p className="figure text-[1.9rem] leading-tight font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="space-y-6">
          <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Priority score</h2>
              <span className="figure text-3xl font-semibold text-accent">{score?.score ?? "–"}</span>
            </div>
            {score ? (
              <>
                <p className="text-sm text-ink-2">
                  {Math.round(score.pRoll * 100)}% chance of rolling to the next DPD bucket within 30 days, scored {formatShortDate(score.asOfDate)} ({score.modelVersion}).
                </p>
                <ul className="mt-3 space-y-2">
                  {score.reasons.map((r) => (
                    <li key={r.key} className="flex items-center gap-2 text-[0.95rem]">
                      {r.effect > 0 ? <ArrowUp className="size-4 shrink-0 text-late" /> : <ArrowDown className="size-4 shrink-0 text-ok" />}
                      <span className="flex-1">{reasonText(r, "en")}</span>
                      <span className="figure text-sm text-ink-3">{r.effect > 0 ? "+" : ""}{r.effect.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                {score.limitedHistory && <p className="mt-2 text-sm text-due">New loan with little payment history: treat the score with care.</p>}
                {d.scores.length > 1 && (
                  <p className="mt-3 text-sm text-ink-2">
                    Last {Math.min(d.scores.length, 30)} scores:{" "}
                    <span className="figure text-base text-ink">
                      {d.scores
                        .slice(0, 10)
                        .map((s) => s.score)
                        .reverse()
                        .join("  ")}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-2">Not scored yet.</p>
            )}
          </div>

          <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-5">
            <h2 className="text-lg font-semibold">Days past due, last {dpdSeries.length} files</h2>
            {dpdSeries.length > 1 ? (
              <svg viewBox="0 0 300 80" className="mt-2 h-auto w-full" role="img" aria-label={`DPD went from ${dpdSeries[0].dpd} to ${dpdSeries[dpdSeries.length - 1].dpd}`}>
                <line x1="0" x2="300" y1={76 - (31 / maxDpd) * 70} y2={76 - (31 / maxDpd) * 70} stroke="var(--color-late)" strokeDasharray="3 3" strokeOpacity=".6" />
                <text x="298" y={72 - (31 / maxDpd) * 70} textAnchor="end" fontSize="8" fill="var(--color-late)">31 DPD</text>
                <path
                  d={`M ${dpdSeries.map((s, i) => `${(i / (dpdSeries.length - 1)) * 296 + 2},${76 - (s.dpd / maxDpd) * 70}`).join(" L ")}`}
                  fill="none"
                  stroke="#2340a0"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <p className="text-sm text-ink-2">Only one file so far.</p>
            )}
          </div>

          <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-5 text-[0.95rem]">
            <h2 className="text-lg font-semibold">Borrower</h2>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="text-sm text-ink-2">Contact</dt>
                <dd>
                  {d.b.contactName}, {maskPhone(d.b.phone)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-2">Address</dt>
                <dd>
                  {d.b.address}
                  {d.b.lat && (
                    <a className="ml-2 inline-flex items-center gap-1 text-sm text-accent hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${d.b.lat},${d.b.lng}`}>
                      <MapPin className="size-3.5" />
                      Map
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-2">Language for reminders</dt>
                <dd>{d.b.language === "hi" ? "Hindi" : "English"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-2xs text-ink-3">Phone numbers are masked here. Opening this page is recorded in the audit trail.</p>
          </div>
        </section>

        <section className="rounded-[var(--radius-control)] border border-rule bg-surface p-5">
          <h2 className="text-lg font-semibold">History</h2>
          {d.promises.length > 0 && (
            <p className="mt-1 text-sm text-ink-2">
              Promises: {d.promises.filter((p) => p.status === "kept").length} kept, {d.promises.filter((p) => p.status === "broken").length} broken, {d.promises.filter((p) => p.status === "open").length} open.
            </p>
          )}
          {timeline.length === 0 ? (
            <p className="mt-3 text-ink-2">No contact recorded yet.</p>
          ) : (
            <ol className="mt-4 border-l border-rule-strong pl-5">
              {timeline.map((e, i) => (
                <li key={i} className="relative pb-4 last:pb-0">
                  <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden />
                  <p className="text-sm text-ink-2">
                    {formatShortDate(istDate(e.at))} {formatISTTime(e.at)}
                  </p>
                  {e.kind === "outcome" && (
                    <p>
                      <span className="font-semibold">{OUTCOME[e.o.o.type]}</span>
                      {e.o.o.amount ? ` ${formatINR(e.o.o.amount)}` : ""}
                      {e.o.o.promisedDate ? ` for ${formatShortDate(e.o.o.promisedDate)}` : ""}
                      <span className="text-ink-2">
                        {" "}
                        by {e.o.officer}, {e.o.o.channel}
                        {e.o.o.reason && e.o.o.type !== "paid" ? `, ${e.o.o.reason.replace(/_/g, " ")}` : ""}
                      </span>
                      {e.o.o.note && <span className="block text-sm text-ink-2">&ldquo;{e.o.o.note}&rdquo;</span>}
                      {e.o.o.createdOffline && <span className="block text-2xs text-ink-3">Logged offline, reached the server {formatISTTime(e.o.o.syncedAt)}</span>}
                    </p>
                  )}
                  {e.kind === "message" && (
                    <p>
                      <span className="font-semibold">Reminder {e.m.status === "sent_simulated" ? "sent" : "blocked"}</span>
                      <span className="block text-sm text-ink-2">{e.m.body}</span>
                    </p>
                  )}
                  {e.kind === "blocked" && (
                    <p className="text-late">
                      {e.a.kind === "call" ? "Call" : e.a.kind === "message" ? "Reminder" : "Visit"} blocked: outside 8 am to 7 pm
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

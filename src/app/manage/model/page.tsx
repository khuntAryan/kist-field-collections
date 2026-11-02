import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getBacktest, latestFileDate } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { BandChart } from "@/components/manage/BandChart";
import { Banner } from "@/components/ui";
import { MODEL } from "@/lib/scoring/model";
import { formatShortDate, istDate } from "@/lib/time";

export const metadata: Metadata = { title: "Score check" };
export const dynamic = "force-dynamic";

const FEATURE_TEXT: Record<string, string> = {
  days_to_next_bucket: "Days until the loan crosses the next DPD bucket (31, 61, 91)",
  dpd_scaled: "Days past due",
  bucket_31_plus: "Already 31+ DPD",
  broken_promises_90d: "Promises broken in the last 90 days",
  paid_ratio_6m: "Share of the last 6 EMIs paid on time",
  months_since_payment: "Time since the last payment",
  unreachable_7d: "Times not reachable in the last 7 days",
  log_outstanding: "Outstanding amount (log scale)",
  has_upcoming_promise: "Has an open promise for today or later",
};

export default async function ModelPage() {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const fileDate = (await latestFileDate(scope)) ?? istDate(await now());
  const weeks = await getBacktest(scope, fileDate);
  const latest = weeks[weeks.length - 1];
  const weak = weeks.filter((w) => w.auc !== null && w.auc < 0.65);
  const maxW = Math.max(...MODEL.weights.map(Math.abs));

  return (
    <>
      <PageHeader
        title="Score check"
        description="Every week Kist compares Monday's priority scores with what borrowers did over the next 7 days. If high scores stop picking out the loans that do not pay, the score needs retraining."
      />

      {weak.length > 0 && (
        <div className="mb-5">
          <Banner tone="late" icon={<TriangleAlert className="size-4" />}>
            The score ranked loans poorly in {weak.length} recent {weak.length === 1 ? "week" : "weeks"} (agreement below 0.65). Lean on manager ordering and retrain the model.
          </Banner>
        </div>
      )}

      {weeks.length === 0 ? (
        <p className="text-ink-2">The first check runs once a week of scores has a week of results behind it.</p>
      ) : (
        <>
          <section className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
            <table className="w-full min-w-[640px] text-left text-[0.95rem]">
              <thead className="text-sm text-ink-2">
                <tr className="border-b border-rule">
                  <th className="px-4 py-2.5 font-medium">Scored on</th>
                  <th className="px-4 py-2.5 text-right font-medium">Loans</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid within 7 days</th>
                  <th className="px-4 py-2.5 text-right font-medium">Not paid: top fifth vs the rest</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ranking agreement</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.scoredOn} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 font-semibold">{formatShortDate(w.scoredOn)}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{w.n}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{Math.round(w.paidRate * 100)}%</td>
                    <td className="figure px-4 py-3 text-right text-lg">
                      {w.topFifthNotPaid === null || w.restNotPaid === null ? "–" : `${Math.round(w.topFifthNotPaid * 100)}% vs ${Math.round(w.restNotPaid * 100)}%`}
                    </td>
                    <td className="figure px-4 py-3 text-right text-lg font-semibold">{w.auc === null ? "–" : w.auc.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="mt-2 max-w-3xl text-sm text-ink-2">
            Ranking agreement (AUC) is the chance that a borrower who did not pay was scored above one who did: 0.5 is a coin toss, 1.0 is perfect. The top fifth by score should fail to pay far more often than the rest; if the two numbers are close, the score is not helping officers.
          </p>

          {latest && (
            <section className="mt-8 rounded-[var(--radius-control)] border border-rule bg-surface p-5">
              <h2 className="text-lg font-semibold">Week of {formatShortDate(latest.scoredOn)}: did higher scores mean less paying?</h2>
              <p className="mb-4 text-sm text-ink-2">Share of loans in each score band that had not paid 7 days later, next to the model&rsquo;s own estimate of rolling.</p>
              <BandChart bands={latest.bands} />
            </section>
          )}
        </>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-5">
          <h2 className="text-lg font-semibold">What the score looks at</h2>
          <p className="mb-3 text-sm text-ink-2">Logistic regression on DPD, payment, promise and contact history and amount. Bars show how strongly each input moves the score; red raises priority, green lowers it.</p>
          <ul className="space-y-2.5">
            {MODEL.features.map((f, i) => {
              const w = MODEL.weights[i];
              return (
                <li key={f} className="grid grid-cols-[1fr_120px] items-center gap-3 text-sm">
                  <span>{FEATURE_TEXT[f] ?? f}</span>
                  <span className="relative h-2.5 rounded-sm bg-paper" title={`weight ${w.toFixed(2)}`}>
                    <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
                    <span
                      className={w > 0 ? "absolute inset-y-0 left-1/2 rounded-r-sm bg-late/80" : "absolute inset-y-0 right-1/2 rounded-l-sm bg-ok/80"}
                      style={{ width: `${(Math.abs(w) / maxW) * 50}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-5 text-[0.95rem]">
          <h2 className="text-lg font-semibold">About this model</h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-sm text-ink-2">Version</dt>
              <dd className="font-semibold">{MODEL.version}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Trained on</dt>
              <dd>{MODEL.trainedOn}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Held-out ranking agreement</dt>
              <dd className="font-semibold">{MODEL.metrics.auc.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Limits</dt>
              <dd>
                Trained on simulated history because the brief has no real loan data. Before go-live, retrain on 12 to 24 months of Company A&rsquo;s own loans. The score is advice; managers can reorder any list, and officers see the three reasons behind each borrower.
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}

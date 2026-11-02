import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getActivity, getAudit, getOfficerStats } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { Chip, cx } from "@/components/ui";
import { formatINR } from "@/lib/format";
import { AT_ADDRESS_METRES, distanceMetres, formatDistance } from "@/lib/geo";
import { addDays, formatISTTime, formatShortDate, isISODate, istDate } from "@/lib/time";

export const metadata: Metadata = { title: "Activity log" };
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, { label: string; tone: "ok" | "accent" | "neutral" | "late" }> = {
  paid: { label: "Paid", tone: "ok" },
  promise: { label: "Promise", tone: "accent" },
  not_reachable: { label: "Not reachable", tone: "neutral" },
  dispute: { label: "Dispute", tone: "late" },
};
const REASON: Record<string, string> = {
  no_answer: "no answer",
  switched_off: "phone off",
  shop_closed: "shop closed",
  wrong_number: "wrong number",
  amount_wrong: "amount wrong",
  already_paid: "says already paid",
  other: "other",
  emi: "EMI",
  overdue_full: "full overdue",
  partial: "part payment",
};
const ACTION: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Failed sign-in",
  "import.commit": "Imported overdue file",
  "import.preview": "Checked an overdue file",
  "import.sample_downloaded": "Downloaded sample file",
  "sync.batch": "Phone synced",
  "contact.blocked": "Contact blocked outside 8 am to 7 pm",
  "list.reorder": "Changed list order",
  "loan.reassign": "Reassigned a loan",
  "loan.viewed": "Opened a borrower's details",
  "loan.dispute_raised": "Dispute raised",
  "message.blocked_words": "Reminder blocked for wording",
  "demo.clock_set": "Set the demo clock",
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ date?: string; officer?: string; tab?: string }> }) {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const at = await now();
  const today = istDate(at);
  const sp = await searchParams;
  const date = sp.date && isISODate(sp.date) && sp.date <= today ? sp.date : today;
  const officers = await getOfficerStats(scope, at);
  const officerId = officers.some((o) => o.id === sp.officer) ? sp.officer! : null;
  const tab = sp.tab === "audit" ? "audit" : "visits";
  const [{ visits, blocked }, audit] = await Promise.all([getActivity(scope, date, officerId), tab === "audit" ? getAudit(scope) : Promise.resolve([])]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const q = (o: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(date !== today ? { date } : {}), ...(officerId ? { officer: officerId } : {}), ...(tab === "audit" ? { tab } : {}) });
    for (const [k, v] of Object.entries(o)) v === null ? p.delete(k) : p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const atAddress = visits.filter((v) => v.channel === "visit" && v.lat && v.bLat && distanceMetres({ lat: v.lat, lng: v.lng! }, { lat: v.bLat, lng: v.bLng! }) <= AT_ADDRESS_METRES).length;
  const visitCount = visits.filter((v) => v.channel === "visit").length;

  return (
    <>
      <PageHeader title="Activity log" description="What officers logged, where they were and when it reached the server. Also every blocked contact and the full audit trail." />

      <div className="mb-5 flex gap-1 border-b border-rule">
        {[
          ["visits", "Field activity"],
          ["audit", "Audit trail"],
        ].map(([id, label]) => (
          <Link key={id} href={`/manage/activity${q({ tab: id === "audit" ? "audit" : null })}`} aria-current={tab === id ? "page" : undefined} className={cx("-mb-px border-b-2 px-3 pb-2 font-semibold", tab === id ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>
            {label}
          </Link>
        ))}
      </div>

      {tab === "visits" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {days.map((d) => (
              <Link key={d} href={`/manage/activity${q({ date: d === today ? null : d })}`} aria-current={d === date ? "true" : undefined} className={cx("h-9 rounded-full border px-3 text-sm leading-[34px] font-semibold", d === date ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-surface text-ink-2 hover:text-ink")}>
                {d === today ? "Today" : formatShortDate(d)}
              </Link>
            ))}
            <span className="mx-1 h-6 w-px bg-rule-strong" aria-hidden />
            <Link href={`/manage/activity${q({ officer: null })}`} className={cx("h-9 rounded-full border px-3 text-sm leading-[34px] font-semibold", !officerId ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-surface text-ink-2")}>
              All officers
            </Link>
            {officers.map((o) => (
              <Link key={o.id} href={`/manage/activity${q({ officer: o.id })}`} className={cx("h-9 rounded-full border px-3 text-sm leading-[34px] font-semibold", officerId === o.id ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-surface text-ink-2 hover:text-ink")}>
                {o.name.split(" ")[0]}
              </Link>
            ))}
          </div>

          <p className="mb-3 text-sm text-ink-2">
            {visits.length} contacts logged{visitCount > 0 && `; ${atAddress} of ${visitCount} visits were logged within ${AT_ADDRESS_METRES} m of the borrower's address`}.
          </p>

          {visits.length === 0 ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-rule-strong px-4 py-6 text-ink-2">Nothing logged {date === today ? "yet today" : `on ${formatShortDate(date)}`}.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
              <table className="w-full min-w-[860px] text-left text-[0.95rem]">
                <thead className="text-sm text-ink-2">
                  <tr className="border-b border-rule">
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-4 py-2.5 font-medium">Officer</th>
                    <th className="px-4 py-2.5 font-medium">Borrower</th>
                    <th className="px-4 py-2.5 font-medium">Outcome</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Reached server</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => {
                    const dist = v.lat && v.bLat ? distanceMetres({ lat: v.lat, lng: v.lng! }, { lat: v.bLat, lng: v.bLng! }) : null;
                    const late = istDate(v.syncedAt) !== istDate(v.at);
                    return (
                      <tr key={v.id} className="border-b border-rule align-top last:border-0">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatISTTime(v.at)}
                          <span className="block text-sm text-ink-3">{v.channel === "visit" ? "Visit" : "Call"}</span>
                        </td>
                        <td className="px-4 py-3">{v.officer}</td>
                        <td className="px-4 py-3">
                          <Link href={`/manage/loans/${v.loanId}`} className="font-semibold hover:text-accent hover:underline">
                            {v.borrower}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <Chip tone={OUTCOME[v.type].tone}>{OUTCOME[v.type].label}</Chip>
                          <span className="ml-1.5 text-sm text-ink-2">
                            {v.amount ? formatINR(v.amount) : ""} {v.reason ? REASON[v.reason] ?? v.reason : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {v.lat && v.lng ? (
                            <a href={`https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                              <MapPin className="size-3.5" />
                              {v.channel === "call" || dist === null ? "Where it was logged" : dist <= AT_ADDRESS_METRES ? `At the address (${formatDistance(dist)})` : `${formatDistance(dist)} from the address`}
                            </a>
                          ) : (
                            <span className="text-due">No GPS ({v.gps})</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={late ? "text-due" : "text-ink-2"}>{late ? `${formatShortDate(istDate(v.syncedAt))} ${formatISTTime(v.syncedAt)}` : formatISTTime(v.syncedAt)}</span>
                          {v.flags.includes("offline") && <span className="block text-ink-3">Logged offline</span>}
                          {v.flags.some((f) => f.startsWith("clock")) && <span className="block text-due">Phone clock was off</span>}
                          {v.flags.includes("reassigned") && <span className="block text-ink-3">Loan moved since</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Blocked contact attempts, last 7 days</h2>
            <p className="mb-2 text-sm text-ink-2">RBI rules allow borrower contact only from 8 am to 7 pm. The app blocks calls, visits and reminders outside that window, and records each attempt.</p>
            {blocked.length === 0 ? (
              <p className="text-ink-2">None.</p>
            ) : (
              <ul className="overflow-hidden rounded-[var(--radius-control)] border border-rule bg-surface">
                {blocked.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-4 py-2.5 text-[0.95rem] last:border-0">
                    <span className="w-28 text-sm text-ink-2">
                      {formatShortDate(istDate(b.at))} {formatISTTime(b.at)}
                    </span>
                    <span className="font-semibold">{b.officer}</span>
                    <span className="text-ink-2">tried to {b.kind === "message" ? "send a reminder to" : b.kind === "visit" ? "log a visit to" : "call"}</span>
                    <Link href={`/manage/loans/${b.loanId}`} className="hover:text-accent hover:underline">
                      {b.borrower}
                    </Link>
                    {b.flags.includes("server_blocked") || b.flags.includes("server_corrected") ? <Chip tone="due">Caught by server check</Chip> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
          <table className="w-full min-w-[760px] text-left text-[0.95rem]">
            <thead className="text-sm text-ink-2">
              <tr className="border-b border-rule">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">What</th>
                <th className="px-4 py-2.5 font-medium">Record</th>
              </tr>
            </thead>
            <tbody>
              {audit.map(({ a, name }) => (
                <tr key={a.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-2.5 text-sm whitespace-nowrap text-ink-2">
                    {formatShortDate(istDate(a.at))} {formatISTTime(a.at)}
                  </td>
                  <td className="px-4 py-2.5">
                    {name ?? "System"} <span className="text-sm text-ink-3">{a.actorRole}</span>
                  </td>
                  <td className="px-4 py-2.5">{ACTION[a.action] ?? a.action}</td>
                  <td className="px-4 py-2.5 text-sm text-ink-2">
                    {a.entityType === "loan" && a.entityId ? (
                      <Link href={`/manage/loans/${a.entityId}`} className="text-accent hover:underline">
                        {a.entityId}
                      </Link>
                    ) : (
                      (a.entityId?.slice(0, 8) ?? "–")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-rule px-4 py-2 text-2xs text-ink-3">Latest 80 entries. The audit trail is append-only; nobody can edit or delete it from the app.</p>
        </div>
      )}
    </>
  );
}

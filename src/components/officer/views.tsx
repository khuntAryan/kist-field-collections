"use client";
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CloudOff,
  Lock,
  LogOut,
  MapPin,
  Phone,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Banner, Button, Chip, EmptyState, cx, dpdTone } from "@/components/ui";
import { formatCompactINR, formatINR, maskPhone } from "@/lib/format";
import { reasonText, tradeLabel, type Lang, type MessageKey } from "@/lib/i18n";
import { addDays, formatISTTime, formatShortDate, istDate } from "@/lib/time";
import type { WindowStatus } from "@/lib/contact-window";
import type { OfficerLoan } from "@/server/queries/officer";
import type { OutboxItem, RejectedItem } from "@/client/officer/store";

export type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export type LoanView = OfficerLoan & {
  todayStatus: { type: string; at: string; pending: boolean } | null;
};

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
};

const OUTCOME_LABEL: Record<string, MessageKey> = {
  paid: "paid",
  promise: "promise",
  not_reachable: "notReachable",
  dispute: "dispute",
};

function durationText(minutes: number, lang: Lang) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (lang === "hi") return h > 0 ? `${h} घं ${m} मि` : `${m} मि`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function ContactWindowLine({ status, t, lang }: { status: WindowStatus; t: T; lang: Lang }) {
  if (status.open) {
    const soon = status.minutesLeft <= 30;
    return (
      <div className={cx("flex items-center gap-2 text-sm", soon ? "text-due" : "text-ok")}>
        <span className={cx("size-2 rounded-full", soon ? "bg-due" : "bg-ok")} aria-hidden />
        <span className="font-medium">{t("windowOpen")}</span>
        <span className="text-ink-2">{t("windowOpenLeft", { time: durationText(status.minutesLeft, lang) })}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-late">
      <Lock className="size-4" aria-hidden />
      {status.reason === "before_window" ? t("windowClosedBefore") : t("windowClosedAfter")}
    </div>
  );
}

export function SyncPill({ online, pending, syncing, t, onClick }: { online: boolean; pending: number; syncing: boolean; t: T; onClick: () => void }) {
  const label = !online ? t("offline") : syncing ? t("syncing") : pending > 0 ? t("pending", { n: pending }) : t("allSynced");
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
        !online ? "border-due/30 bg-due-soft text-due" : pending > 0 ? "border-accent/25 bg-accent-soft text-accent" : "border-rule bg-surface text-ink-2",
      )}
    >
      {!online ? <CloudOff className="size-4" /> : <RefreshCw className={cx("size-4", syncing && "animate-spin")} />}
      <span className="max-w-32 truncate">{label}</span>
    </button>
  );
}

function ReasonLine({ reason, lang, compact }: { reason: OfficerLoan["reasons"][number]; lang: Lang; compact?: boolean }) {
  const up = reason.effect > 0;
  return (
    <span className={cx("flex items-start gap-1.5", compact ? "text-sm" : "text-[0.95rem]")}>
      {up ? <ArrowUp className="mt-0.5 size-4 shrink-0 text-late" aria-label="raises priority" /> : <ArrowDown className="mt-0.5 size-4 shrink-0 text-ok" aria-label="lowers priority" />}
      <span>{reasonText(reason, lang)}</span>
    </span>
  );
}

function PromiseChip({ loan, t, lang, today }: { loan: OfficerLoan; t: T; lang: Lang; today: string }) {
  const p = loan.promise;
  if (!p) return null;
  if (p.status === "broken" || (p.status === "open" && p.date < today))
    return <Chip tone="late">{t("promiseBroken", { date: formatShortDate(p.date, lang) })}</Chip>;
  if (p.status === "kept") return <Chip tone="ok">{t("promiseKept")}</Chip>;
  return <Chip tone={p.date === today ? "due" : "accent"}>{t("promiseOn", { date: formatShortDate(p.date, lang) })}</Chip>;
}

type RowActions = {
  onOpen: (id: string) => void;
  onCall: (loan: OfficerLoan) => void;
  onMap: (loan: OfficerLoan) => void;
  onLog: (loan: OfficerLoan) => void;
};

function LoanRow({ loan, rank, t, lang, today, contactOpen, actions }: { loan: LoanView; rank: number; t: T; lang: Lang; today: string; contactOpen: boolean } & { actions: RowActions }) {
  const top = loan.reasons[0];
  return (
    <li className="border-b border-rule last:border-b-0">
      <div className="flex gap-3 px-4 pt-3.5 pb-4">
        <span className="figure w-7 shrink-0 pt-0.5 text-right text-[1.7rem] leading-none font-semibold text-accent" aria-label={`#${rank}`}>
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <button onClick={() => actions.onOpen(loan.id)} className="block w-full text-left">
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[1.08rem] font-semibold">{loan.name}</span>
              <span className="figure shrink-0 text-[1.25rem] font-semibold">{formatCompactINR(loan.overdueAmount, lang)}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              <span>{tradeLabel(loan.businessType, lang)}</span>
              <Chip tone={dpdTone(loan.dpd)}>{t("dpd", { n: loan.dpd })}</Chip>
              <PromiseChip loan={loan} t={t} lang={lang} today={today} />
              {loan.movedByManager && <Chip tone="accent">{t("movedUp")}</Chip>}
              {loan.disputed && <Chip tone="late">{t("disputed")}</Chip>}
            </span>
            {top && (
              <span className="mt-2 block text-ink">
                <ReasonLine reason={top} lang={lang} compact />
              </span>
            )}
          </button>
          <div className="mt-3 grid grid-cols-[1fr_1fr_1.5fr] gap-2">
            <Button variant="secondary" size="md" onClick={() => actions.onCall(loan)} icon={contactOpen ? <Phone className="size-4" /> : <Lock className="size-4" />} aria-label={`${t("call")} ${loan.name}`}>
              {t("call")}
            </Button>
            <Button variant="secondary" size="md" onClick={() => actions.onMap(loan)} icon={<MapPin className="size-4" />} aria-label={`${t("map")} ${loan.name}`}>
              {t("map")}
            </Button>
            <Button size="md" onClick={() => actions.onLog(loan)} icon={<ClipboardCheck className="size-4" />} aria-label={`${t("logOutcome")} ${loan.name}`}>
              {t("logShort")}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function DoneRow({ loan, t, lang, onOpen }: { loan: LoanView; t: T; lang: Lang; onOpen: (id: string) => void }) {
  const s = loan.todayStatus!;
  const tone = s.type === "paid" ? "ok" : s.type === "promise" ? "accent" : s.type === "dispute" ? "late" : "neutral";
  return (
    <li className="border-b border-rule last:border-b-0">
      <button onClick={() => onOpen(loan.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{loan.name}</span>
          <span className="text-sm text-ink-2">{formatISTTime(new Date(s.at), lang)}</span>
        </span>
        <Chip tone={tone}>{t(OUTCOME_LABEL[s.type] ?? "saved")}</Chip>
        {s.pending && <CloudOff className="size-4 text-due" aria-label={t("savedOffline")} />}
        <ChevronRight className="size-4 text-ink-3" aria-hidden />
      </button>
    </li>
  );
}

export function TodayView(props: {
  t: T;
  lang: Lang;
  now: Date;
  officerName: string;
  branchName: string;
  loans: LoanView[];
  fileDate: string | null;
  window: WindowStatus;
  header: React.ReactNode;
  notices: React.ReactNode;
  actions: RowActions;
}) {
  const { t, lang, now, loans, window: win } = props;
  const today = istDate(now);
  const [showMore, setShowMore] = useState(false);
  const pending = loans.filter((l) => !l.todayStatus);
  const done = loans.filter((l) => l.todayStatus);
  const first = pending.slice(0, 8);
  const rest = pending.slice(8);
  const total = loans.reduce((s, l) => s + l.overdueAmount, 0);
  const weekday = WEEKDAYS[lang][new Date(`${today}T12:00:00Z`).getUTCDay()];

  return (
    <div>
      <header className="bg-surface px-4 pt-4 pb-3 border-b border-rule">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[1.45rem] leading-tight font-semibold narrow">{t("greeting", { name: props.officerName.split(" ")[0] })}</h1>
            <p className="text-sm text-ink-2">
              {weekday}, {formatShortDate(today, lang)} <span className="text-ink-3">|</span> {props.branchName}
            </p>
          </div>
          {props.header}
        </div>
        <div className="mt-3">
          <ContactWindowLine status={win} t={t} lang={lang} />
        </div>
        {loans.length > 0 && (
          <p className="mt-2 text-sm text-ink-2">
            <span className="font-semibold text-ink">{t("borrowers", { n: loans.length })}</span>
            <span className="mx-1.5 text-ink-3">|</span>
            {t("overdueTotal", { amount: formatCompactINR(total, lang) })}
          </p>
        )}
      </header>

      <div className="space-y-2 px-4 pt-3 empty:hidden">{props.notices}</div>

      {loans.length === 0 ? (
        <EmptyState title={t("emptyListTitle")} body={t("emptyListBody")} />
      ) : (
        <>
          {first.length > 0 && (
            <section aria-labelledby="first-h" className="mt-3">
              <h2 id="first-h" className="px-4 pb-1.5 text-sm font-semibold text-ink-2">
                {t("topPriorities")}
              </h2>
              <ol className="border-y border-rule bg-surface">
                {first.map((l, i) => (
                  <LoanRow key={l.id} loan={l} rank={i + 1} t={t} lang={lang} today={today} contactOpen={win.open} actions={props.actions} />
                ))}
              </ol>
            </section>
          )}
          {rest.length > 0 && (
            <section className="mt-4">
              <button
                onClick={() => setShowMore((v) => !v)}
                aria-expanded={showMore}
                className="flex w-full items-center justify-between px-4 py-2 text-sm font-semibold text-ink-2"
              >
                <span>
                  {t("others")} ({rest.length})
                </span>
                <ChevronRight className={cx("size-4 transition-transform", showMore && "rotate-90")} />
              </button>
              {showMore && (
                <ol className="border-y border-rule bg-surface">
                  {rest.map((l, i) => (
                    <LoanRow key={l.id} loan={l} rank={first.length + i + 1} t={t} lang={lang} today={today} contactOpen={win.open} actions={props.actions} />
                  ))}
                </ol>
              )}
            </section>
          )}
          <section className="mt-5 mb-6">
            <h2 className="px-4 pb-1.5 text-sm font-semibold text-ink-2">
              {t("doneToday")} {done.length > 0 && `(${done.length})`}
            </h2>
            {done.length === 0 ? (
              <p className="px-4 text-sm text-ink-3">{t("noneDone")}</p>
            ) : (
              <ul className="border-y border-rule bg-surface">
                {done.map((l) => (
                  <DoneRow key={l.id} loan={l} t={t} lang={lang} onOpen={props.actions.onOpen} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const CHANNEL_KEY: Record<string, MessageKey> = { visit: "visit", call: "callChannel" };

export function LoanDetail({
  loan,
  t,
  lang,
  now,
  window: win,
  onBack,
  actions,
  onRemind,
}: {
  loan: LoanView;
  t: T;
  lang: Lang;
  now: Date;
  window: WindowStatus;
  onBack: () => void;
  actions: RowActions;
  onRemind: (loan: OfficerLoan) => void;
}) {
  const today = istDate(now);
  return (
    <div className="pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-surface/95 px-2 py-2 backdrop-blur">
        <Button variant="ghost" size="md" onClick={onBack} icon={<ChevronLeft className="size-5" />}>
          {t("back")}
        </Button>
        <span className="ml-auto pr-2 text-sm text-ink-3">{loan.id}</span>
      </header>

      <section className="bg-surface px-4 pt-4 pb-5 border-b border-rule">
        <h1 className="text-[1.6rem] leading-tight font-semibold narrow">{loan.name}</h1>
        <p className="text-ink-2">{tradeLabel(loan.businessType, lang)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={dpdTone(loan.dpd)}>{t("dpd", { n: loan.dpd })}</Chip>
          <PromiseChip loan={loan} t={t} lang={lang} today={today} />
          {loan.disputed && <Chip tone="late">{t("disputed")}</Chip>}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {[
            [t("overdueAmt"), formatINR(loan.overdueAmount)],
            [t("emi"), formatINR(loan.emi)],
            [t("outstanding"), formatCompactINR(loan.outstanding, lang)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-2xs text-ink-2">{k}</dt>
              <dd className="figure text-[1.3rem] leading-tight font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => actions.onCall(loan)} icon={win.open ? <Phone className="size-5" /> : <Lock className="size-5" />}>
            {t("call")}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => actions.onMap(loan)} icon={<MapPin className="size-5" />}>
            {t("map")}
          </Button>
          <Button size="lg" className="col-span-2" onClick={() => actions.onLog(loan)} icon={<ClipboardCheck className="size-5" />}>
            {t("logOutcome")}
          </Button>
          <Button variant="ghost" size="md" className="col-span-2" onClick={() => onRemind(loan)} icon={<BellRing className="size-4" />}>
            {t("sendReminder")}
          </Button>
        </div>
      </section>

      <section className="px-4 pt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">{t("whyThisScore")}</h2>
          <span className="figure text-lg font-semibold text-accent">{t("score", { n: loan.score })}</span>
        </div>
        {loan.reasons.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {loan.reasons.map((r) => (
              <li key={r.key}>
                <ReasonLine reason={r} lang={lang} />
              </li>
            ))}
          </ul>
        ) : null}
        {loan.limitedHistory && (
          <p className="mt-3 flex gap-1.5 text-sm text-due">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("limitedHistory")}
          </p>
        )}
        <p className="mt-2 text-2xs text-ink-3">{t("scoreIsAdvice")}</p>
      </section>

      <section className="px-4 pt-6">
        <dl className="space-y-3 text-[0.95rem]">
          <div>
            <dt className="text-2xs text-ink-2">{t("contactPerson")}</dt>
            <dd>
              {loan.contactName} <span className="text-ink-3">{maskPhone(loan.phone)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-2xs text-ink-2">{t("address")}</dt>
            <dd>{loan.address}</dd>
          </div>
        </dl>
      </section>

      <section className="px-4 pt-6">
        <h2 className="font-semibold">{t("recent")}</h2>
        {loan.history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">{t("noHistory")}</p>
        ) : (
          <ol className="mt-2 border-l border-rule-strong pl-4">
            {loan.history.map((h) => (
              <li key={h.id} className="relative pb-3 last:pb-0">
                <span className="absolute top-2 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden />
                <p className="text-[0.95rem]">
                  <span className="font-medium">{t(OUTCOME_LABEL[h.type] ?? "saved")}</span>
                  {h.type === "paid" && h.amount ? ` ${formatINR(h.amount)}` : ""}
                  {h.type === "promise" && h.promisedDate ? ` ${formatShortDate(h.promisedDate, lang)}` : ""}
                  {h.reason && h.type !== "paid" ? <span className="text-ink-2"> ({t(h.reason as MessageKey)})</span> : null}
                </p>
                <p className="text-2xs text-ink-2">
                  {formatShortDate(istDate(new Date(h.at)), lang)} {formatISTTime(new Date(h.at), lang)} <span className="text-ink-3">|</span> {t(CHANNEL_KEY[h.channel])}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function PromisesView({ loans, t, lang, now, onOpen, onRemind }: { loans: LoanView[]; t: T; lang: Lang; now: Date; onOpen: (id: string) => void; onRemind: (loan: OfficerLoan) => void }) {
  const today = istDate(now);
  const withPromise = loans.filter((l) => l.promise && l.promise.status !== "kept");
  const isBroken = (l: LoanView) => l.promise!.status === "broken" || l.promise!.date < today;
  const groups: { key: MessageKey; items: LoanView[]; tone: "due" | "late" | "accent" }[] = [
    { key: "dueToday", items: withPromise.filter((l) => !isBroken(l) && l.promise!.date === today), tone: "due" },
    { key: "broken", items: withPromise.filter(isBroken), tone: "late" },
    { key: "upcoming", items: withPromise.filter((l) => !isBroken(l) && l.promise!.date > today).sort((a, b) => a.promise!.date.localeCompare(b.promise!.date)), tone: "accent" },
  ];
  return (
    <div>
      <header className="border-b border-rule bg-surface px-4 pt-4 pb-3">
        <h1 className="text-[1.45rem] font-semibold narrow">{t("promisesTab")}</h1>
      </header>
      {withPromise.length === 0 ? (
        <EmptyState title={t("promisesTab")} body={t("noPromises")} />
      ) : (
        groups.map((g) =>
          g.items.length === 0 ? null : (
            <section key={g.key} className="mt-4">
              <h2 className="px-4 pb-1.5 text-sm font-semibold text-ink-2">
                {t(g.key)} ({g.items.length})
              </h2>
              <ul className="border-y border-rule bg-surface">
                {g.items.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                    <button onClick={() => onOpen(l.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-semibold">{l.name}</span>
                      <span className="flex items-center gap-2 text-sm text-ink-2">
                        <span className="figure text-base font-semibold text-ink">{formatINR(l.promise!.amount)}</span>
                        <Chip tone={g.tone}>{formatShortDate(l.promise!.date, lang)}</Chip>
                        {l.todayStatus && <Chip tone="neutral">{t(OUTCOME_LABEL[l.todayStatus.type] ?? "saved")}</Chip>}
                      </span>
                    </button>
                    {g.key !== "upcoming" || l.promise!.date === addDays(today, 1) ? (
                      <Button variant="secondary" size="md" onClick={() => onRemind(l)} icon={<BellRing className="size-4" />}>
                        {t("reminder")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ),
        )
      )}
    </div>
  );
}

const EVENT_LABEL = (item: { event: OutboxItem["event"] }, t: T): string => {
  const e = item.event;
  if (e.kind === "outcome") return t(OUTCOME_LABEL[e.type]);
  if (e.kind === "message") return t("reminder");
  return e.attemptKind === "call" ? t("call") : t("visit");
};

export function SyncView(props: {
  t: T;
  lang: Lang;
  online: boolean;
  syncing: boolean;
  signedOut: boolean;
  lastSync: number | null;
  outbox: OutboxItem[];
  rejected: RejectedItem[];
  loansById: Map<string, OfficerLoan>;
  onSync: () => void;
  onDismiss: (id: string) => void;
  onLang: (l: Lang) => void;
  onSignOut: (force: boolean) => void;
  demoMode: boolean;
  demoClock: string | null;
  onDemoClock: (time: string | null) => void;
}) {
  const { t, lang } = props;
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const pending = props.outbox.length;
  return (
    <div className="pb-8">
      <header className="border-b border-rule bg-surface px-4 pt-4 pb-3">
        <h1 className="text-[1.45rem] font-semibold narrow">{t("syncTitle")}</h1>
      </header>

      <section className="space-y-3 px-4 pt-4">
        <div className="rounded-[var(--radius-control)] border border-rule bg-surface p-4">
          <p className={cx("flex items-center gap-2 font-semibold", props.online ? "text-ok" : "text-due")}>
            {props.online ? <RefreshCw className="size-4" /> : <CloudOff className="size-4" />}
            {props.online ? t("online") : t("offline")}
          </p>
          <p className="mt-1 text-[0.95rem]">{pending > 0 ? t("pending", { n: pending }) : t("allSynced")}</p>
          <p className="text-sm text-ink-2">
            {props.lastSync ? t("lastSynced", { time: formatISTTime(new Date(props.lastSync), lang) }) : t("neverSynced")}
          </p>
          {props.signedOut && (
            <div className="mt-3">
              <Banner tone="due" icon={<TriangleAlert className="size-4" />} action={<a href="/login" className="font-semibold underline">{t("signIn")}</a>}>
                {t("signedOutSync", { n: pending })}
              </Banner>
            </div>
          )}
          <Button className="mt-3 w-full" size="lg" onClick={props.onSync} busy={props.syncing} disabled={!props.online} icon={<RefreshCw className="size-4" />}>
            {props.syncing ? t("syncing") : t("syncNow")}
          </Button>
        </div>

        {pending > 0 && (
          <ul className="rounded-[var(--radius-control)] border border-rule bg-surface">
            {props.outbox.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2.5 text-sm last:border-b-0">
                <span className="truncate">
                  <span className="font-medium">{props.loansById.get(i.event.loanId)?.name ?? i.event.loanId}</span>{" "}
                  <span className="text-ink-2">{EVENT_LABEL(i, t)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-ink-3">
                  <Clock className="size-3.5" />
                  {formatISTTime(new Date(i.createdAt), lang)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {props.rejected.length > 0 && (
          <div className="rounded-[var(--radius-control)] border border-late/30 bg-surface">
            <div className="border-b border-rule px-4 py-3">
              <p className="font-semibold text-late">{t("needsAttention")}</p>
              <p className="text-sm text-ink-2">{t("rejectedHelp")}</p>
            </div>
            <ul>
              {props.rejected.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{props.loansById.get(r.event.loanId)?.name ?? r.event.loanId}</span>{" "}
                    <span className="text-ink-2">{EVENT_LABEL(r, t)}</span>
                    <span className="mt-0.5 block text-late">{r.message}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => props.onDismiss(r.id)}>
                    {t("dismiss")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="mt-6 px-4">
        <h2 className="text-sm font-semibold text-ink-2">{t("language")}</h2>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("language")}>
          {(["hi", "en"] as const).map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={lang === l}
              onClick={() => props.onLang(l)}
              className={cx(
                "h-12 rounded-[var(--radius-control)] border font-semibold",
                lang === l ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-surface",
              )}
            >
              {l === "hi" ? "हिन्दी" : "English"}
            </button>
          ))}
        </div>
      </section>

      {props.demoMode && (
        <section className="mt-6 px-4">
          <h2 className="text-sm font-semibold text-ink-2">{t("demoClock")}</h2>
          <p className="text-sm text-ink-2">{t("demoClockHelp")}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              [null, t("realTime")],
              ["10:30", "10:30 am"],
              ["20:15", "8:15 pm"],
            ].map(([v, label]) => (
              <button
                key={label}
                onClick={() => props.onDemoClock(v)}
                aria-pressed={props.demoClock === v}
                className={cx(
                  "h-11 rounded-[var(--radius-control)] border text-sm font-semibold",
                  props.demoClock === v ? "border-accent bg-accent-soft text-accent" : "border-rule-strong bg-surface",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8 px-4">
        <p className="mb-2 text-2xs text-ink-3">{t("phoneData")}</p>
        {confirmSignOut && pending > 0 ? (
          <Banner tone="late" icon={<TriangleAlert className="size-4" />}>
            <p>{t("signOutPending", { n: pending })}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => setConfirmSignOut(false)}>{t("cancel")}</Button>
              <Button size="sm" variant="danger" onClick={() => props.onSignOut(true)}>{t("signOutAnyway")}</Button>
            </div>
          </Banner>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => (pending > 0 ? setConfirmSignOut(true) : props.onSignOut(false))} icon={<LogOut className="size-4" />}>
            {t("signOut")}
          </Button>
        )}
      </section>
    </div>
  );
}

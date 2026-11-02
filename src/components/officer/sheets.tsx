"use client";
import { useEffect, useRef, useState } from "react";
import { Banknote, CalendarClock, Lock, MapPin, PhoneOff, Scale, Send, TriangleAlert, X } from "lucide-react";
import { Banner, Button, cx } from "@/components/ui";
import { formatINR, maskPhone } from "@/lib/format";
import { type Lang, type MessageKey } from "@/lib/i18n";
import { addDays, formatShortDate, istDate, istDateTime, istParts } from "@/lib/time";
import { CONTACT_END_MIN, CONTACT_START_MIN, type WindowStatus } from "@/lib/contact-window";
import { choosePurpose, findBlockedPhrases, MAX_MESSAGE_LENGTH, renderTemplate } from "@/lib/templates";
import { MAX_PROMISE_DAYS } from "@/lib/promises";
import { DISPUTE_REASONS, NOT_REACHABLE_REASONS } from "@/lib/sync-protocol";
import type { OfficerLoan } from "@/server/queries/officer";
import type { GpsReading } from "@/client/officer/geo";
import type { T } from "./views";

export function Sheet({ title, subtitle, onClose, children, closeLabel }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; closeLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button aria-label={closeLabel} onClick={onClose} className="animate-fade absolute inset-0 bg-ink/35" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-sheet)] bg-surface pb-safe shadow-[0_-8px_30px_rgba(23,32,51,0.18)] outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-surface px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-lg leading-tight font-semibold narrow">{title}</h2>
            {subtitle && <p className="truncate text-sm text-ink-2">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label={closeLabel} className="-mr-2 grid size-11 place-items-center rounded-full text-ink-2 hover:bg-paper">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-4 pt-3 pb-5">{children}</div>
      </div>
    </div>
  );
}

export type OutcomeDraft = {
  type: "paid" | "promise" | "not_reachable" | "dispute";
  channel: "visit" | "call";
  occurredAt: Date; // corrected (India) time of the contact
  reason?: string;
  amount?: number;
  promisedDate?: string;
  note?: string;
};

type Step = "type" | "paid" | "promise" | "not_reachable" | "dispute";

const TILE: { type: OutcomeDraft["type"]; key: MessageKey; icon: React.ReactNode; tone: string }[] = [
  { type: "paid", key: "paid", icon: <Banknote className="size-6" />, tone: "text-ok" },
  { type: "promise", key: "promise", icon: <CalendarClock className="size-6" />, tone: "text-accent" },
  { type: "not_reachable", key: "notReachable", icon: <PhoneOff className="size-6" />, tone: "text-ink-2" },
  { type: "dispute", key: "dispute", icon: <Scale className="size-6" />, tone: "text-late" },
];

function ChoiceButton({ children, onClick, disabled, sub }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; sub?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-4 py-3 text-left text-[1.02rem] font-semibold hover:border-accent hover:bg-accent-soft disabled:opacity-50"
    >
      <span>{children}</span>
      {sub && <span className="text-sm font-normal text-ink-2">{sub}</span>}
    </button>
  );
}

/**
 * Logging an outcome takes three taps: open the sheet, pick what happened, pick the detail.
 * The detail button saves straight away; an Undo toast covers mistakes.
 */
export function OutcomeSheet({
  loan,
  t,
  lang,
  now,
  window: win,
  defaultChannel,
  gps,
  onSave,
  onClose,
}: {
  loan: OfficerLoan;
  t: T;
  lang: Lang;
  now: Date;
  window: WindowStatus;
  defaultChannel: "visit" | "call";
  gps: GpsReading | null;
  onSave: (d: OutcomeDraft) => void;
  onClose: () => void;
}) {
  const today = istDate(now);
  const nowMin = istParts(now).minuteOfDay;
  const [step, setStep] = useState<Step>("type");
  const [channel, setChannel] = useState(defaultChannel);
  const afterHours = !win.open && win.reason === "after_window";
  const beforeHours = !win.open && win.reason === "before_window";
  const [when, setWhen] = useState<"now" | "earlier">(afterHours ? "earlier" : "now");
  const [time, setTime] = useState("");
  const [otherAmount, setOtherAmount] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [promiseAmount, setPromiseAmount] = useState(String(Math.min(loan.overdueAmount, loan.emi)));
  const [editAmount, setEditAmount] = useState(false);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const maxMin = Math.min(afterHours ? CONTACT_END_MIN - 1 : nowMin, CONTACT_END_MIN - 1);
  const maxTime = `${String(Math.floor(maxMin / 60)).padStart(2, "0")}:${String(maxMin % 60).padStart(2, "0")}`;
  const timeValid = (() => {
    if (when === "now") return win.open;
    const m = time.match(/^(\d{2}):(\d{2})$/);
    if (!m) return false;
    const mins = Number(m[1]) * 60 + Number(m[2]);
    return mins >= CONTACT_START_MIN && mins < CONTACT_END_MIN && mins <= nowMin;
  })();
  const occurredAt = (): Date => {
    if (when === "now") return now;
    const [h, m] = time.split(":").map(Number);
    return istDateTime(today, h, m);
  };
  const save = (d: Omit<OutcomeDraft, "channel" | "occurredAt">) => onSave({ ...d, channel, occurredAt: occurredAt() });

  const titleFor: Record<Step, MessageKey> = { type: "whatHappened", paid: "howMuch", promise: "whenWillPay", not_reachable: "why", dispute: "why" };
  const dates = [1, 3, 7].map((n) => addDays(today, n));
  const amount = Number(promiseAmount.replace(/\D/g, ""));
  const otherValue = Number(otherAmount.replace(/\D/g, ""));

  return (
    <Sheet title={t(titleFor[step])} subtitle={loan.name} onClose={onClose} closeLabel={t("cancel")}>
      {beforeHours ? (
        <Banner tone="late" icon={<Lock className="size-4" />}>
          {t("beforeHoursLog")}
        </Banner>
      ) : (
        <>
          {step === "type" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("visit") + " / " + t("callChannel")}>
                {(["visit", "call"] as const).map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={channel === c}
                    onClick={() => setChannel(c)}
                    className={cx("h-11 rounded-[var(--radius-control)] border font-semibold", channel === c ? "border-accent bg-accent-soft text-accent" : "border-rule-strong")}
                  >
                    {c === "visit" ? t("visit") : t("callChannel")}
                  </button>
                ))}
              </div>

              {afterHours && <Banner tone="due" icon={<Lock className="size-4" />}>{t("afterHoursLog")}</Banner>}
              <div>
                <p className="text-sm font-semibold text-ink-2">{t("whenHappened")}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {!afterHours && (
                    <button
                      onClick={() => setWhen("now")}
                      aria-pressed={when === "now"}
                      className={cx("h-11 rounded-[var(--radius-control)] border px-4 font-semibold", when === "now" ? "border-accent bg-accent-soft text-accent" : "border-rule-strong")}
                    >
                      {t("now")}
                    </button>
                  )}
                  <button
                    onClick={() => setWhen("earlier")}
                    aria-pressed={when === "earlier"}
                    className={cx("h-11 rounded-[var(--radius-control)] border px-4 font-semibold", when === "earlier" ? "border-accent bg-accent-soft text-accent" : "border-rule-strong")}
                  >
                    {t("earlierToday")}
                  </button>
                  {when === "earlier" && (
                    <input
                      type="time"
                      aria-label={t("pickTime")}
                      min="08:00"
                      max={maxTime}
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-11 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3"
                    />
                  )}
                </div>
                {when === "earlier" && !timeValid && <p className="mt-1 text-sm text-due">{t("pickTime")} (8:00 – {maxTime})</p>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {TILE.map((tile) => (
                  <button
                    key={tile.type}
                    disabled={!timeValid}
                    onClick={() => setStep(tile.type)}
                    className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-rule-strong bg-surface text-[1.02rem] font-semibold hover:border-accent hover:bg-accent-soft disabled:opacity-40"
                  >
                    <span className={tile.tone}>{tile.icon}</span>
                    {t(tile.key)}
                  </button>
                ))}
              </div>
              <GpsLine gps={gps} t={t} />
            </div>
          )}

          {step === "paid" && (
            <div className="space-y-2">
              <ChoiceButton onClick={() => save({ type: "paid", amount: loan.emi, reason: "emi" })}>{t("emiAmount", { amount: formatINR(loan.emi) })}</ChoiceButton>
              {loan.overdueAmount !== loan.emi && (
                <ChoiceButton onClick={() => save({ type: "paid", amount: loan.overdueAmount, reason: "overdue_full" })}>
                  {t("fullOverdue", { amount: formatINR(loan.overdueAmount) })}
                </ChoiceButton>
              )}
              {!showOther ? (
                <ChoiceButton onClick={() => setShowOther(true)}>{t("otherAmount")}</ChoiceButton>
              ) : (
                <div className="flex gap-2">
                  <label className="flex h-14 flex-1 items-center gap-1 rounded-[var(--radius-control)] border border-rule-strong px-3 focus-within:border-accent">
                    <span className="text-ink-2">₹</span>
                    <input
                      autoFocus
                      inputMode="numeric"
                      aria-label={t("otherAmount")}
                      value={otherAmount}
                      onChange={(e) => setOtherAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
                      className="figure w-full bg-transparent text-xl font-semibold outline-none"
                    />
                  </label>
                  <Button size="lg" disabled={!otherValue} onClick={() => save({ type: "paid", amount: otherValue, reason: "partial" })}>
                    {t("saveAmount", { amount: otherValue ? formatINR(otherValue) : "" })}
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === "promise" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-[var(--radius-control)] bg-paper px-3 py-2 text-sm">
                {editAmount ? (
                  <label className="flex flex-1 items-center gap-1">
                    <span className="text-ink-2">₹</span>
                    <input
                      autoFocus
                      inputMode="numeric"
                      aria-label={t("promiseAmount", { amount: "" })}
                      value={promiseAmount}
                      onChange={(e) => setPromiseAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
                      className="figure w-full bg-transparent text-lg font-semibold outline-none"
                    />
                  </label>
                ) : (
                  <span className="font-medium">{t("promiseAmount", { amount: formatINR(amount) })}</span>
                )}
                <button onClick={() => setEditAmount((v) => !v)} className="h-9 px-2 font-semibold text-accent">
                  {editAmount ? "OK" : t("change")}
                </button>
              </div>
              {dates.map((d, i) => (
                <ChoiceButton key={d} disabled={!amount} onClick={() => save({ type: "promise", promisedDate: d, amount })} sub={formatShortDate(d, lang)}>
                  {i === 0 ? t("tomorrow") : t("inDays", { n: [1, 3, 7][i] })}
                </ChoiceButton>
              ))}
              <div className="flex gap-2">
                <input
                  type="date"
                  aria-label={t("pickDate")}
                  min={addDays(today, 1)}
                  max={addDays(today, MAX_PROMISE_DAYS)}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="h-14 flex-1 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3"
                />
                <Button size="lg" disabled={!customDate || !amount || customDate <= today || customDate > addDays(today, MAX_PROMISE_DAYS)} onClick={() => save({ type: "promise", promisedDate: customDate, amount })}>
                  {customDate ? t("savePromise", { date: formatShortDate(customDate, lang) }) : t("pickDate")}
                </Button>
              </div>
            </div>
          )}

          {step === "not_reachable" && (
            <div className="space-y-2">
              {NOT_REACHABLE_REASONS.map((r) => (
                <ChoiceButton key={r} onClick={() => save({ type: "not_reachable", reason: r })}>
                  {t(r)}
                </ChoiceButton>
              ))}
            </div>
          )}

          {step === "dispute" && (
            <div className="space-y-2">
              {DISPUTE_REASONS.filter((r) => r !== "other").map((r) => (
                <ChoiceButton key={r} onClick={() => save({ type: "dispute", reason: r })}>
                  {t(r)}
                </ChoiceButton>
              ))}
              {!showNote ? (
                <ChoiceButton onClick={() => setShowNote(true)}>{t("other")}</ChoiceButton>
              ) : (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    aria-label={t("noteRequired")}
                    placeholder={t("noteRequired")}
                    maxLength={280}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-h-24 w-full rounded-[var(--radius-control)] border border-rule-strong p-3 outline-none focus:border-accent"
                  />
                  <Button size="lg" className="w-full" disabled={note.trim().length < 3} onClick={() => save({ type: "dispute", reason: "other", note: note.trim() })}>
                    {t("saveDispute")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {step !== "type" && (
            <button onClick={() => setStep("type")} className="mt-4 h-11 font-semibold text-accent">
              {t("back")}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

function GpsLine({ gps, t }: { gps: GpsReading | null; t: T }) {
  return (
    <p className={cx("flex items-center gap-1.5 text-sm", gps && gps.status !== "ok" ? "text-due" : "text-ink-2")}>
      <MapPin className="size-4" />
      {!gps ? t("locating") : gps.status === "ok" ? t("located", { m: gps.accuracy ?? 0 }) : t("noLocation")}
    </p>
  );
}

/** Reminder drafted from an approved template. Officer can edit; the wording filter runs on every keystroke. */
export function ReminderSheet({
  loan,
  templates,
  t,
  now,
  window: win,
  officerName,
  onSend,
  onClose,
}: {
  loan: OfficerLoan;
  templates: { id: string; purpose: string; language: string; body: string }[];
  t: T;
  lang: Lang;
  now: Date;
  window: WindowStatus;
  officerName: string;
  onSend: (templateId: string, language: "hi" | "en", body: string) => void;
  onClose: () => void;
}) {
  const today = istDate(now);
  const p = loan.promise;
  const purpose = choosePurpose({
    promisedDate: p && p.status === "open" && p.date >= today ? p.date : null,
    promiseBroken: !!p && (p.status === "broken" || (p.status === "open" && p.date < today)),
    today,
    tomorrow: addDays(today, 1),
  });
  const [msgLang, setMsgLang] = useState<"hi" | "en">(loan.language);
  const template = templates.find((x) => x.purpose === purpose && x.language === msgLang);
  const draftFor = (l: "hi" | "en") => {
    const tpl = templates.find((x) => x.purpose === purpose && x.language === l);
    if (!tpl) return "";
    try {
      return renderTemplate(tpl.body, {
        contact: loan.contactName,
        business: loan.name,
        amount: formatINR(p && p.status !== "kept" ? p.amount : loan.overdueAmount),
        date: formatShortDate(p ? p.date : today, l),
        officer: officerName.split(" ")[0],
      });
    } catch {
      return "";
    }
  };
  const [body, setBody] = useState(() => draftFor(loan.language));

  const blocked = findBlockedPhrases(body);
  const tooLong = body.length > MAX_MESSAGE_LENGTH;
  const canSend = win.open && !!template && body.trim().length > 0 && blocked.length === 0 && !tooLong;

  return (
    <Sheet title={t("reminder")} subtitle={loan.name} onClose={onClose} closeLabel={t("cancel")}>
      <p className="text-sm text-ink-2">{t("reminderTo", { name: loan.contactName, phone: maskPhone(loan.phone) })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["hi", "en"] as const).map((l) => (
          <button
            key={l}
            onClick={() => {
              setMsgLang(l);
              setBody(draftFor(l));
            }}
            aria-pressed={msgLang === l}
            className={cx("h-10 rounded-[var(--radius-control)] border text-sm font-semibold", msgLang === l ? "border-accent bg-accent-soft text-accent" : "border-rule-strong")}
          >
            {l === "hi" ? "हिन्दी" : "English"}
          </button>
        ))}
      </div>
      <textarea
        aria-label={t("reminder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={cx("mt-3 min-h-40 w-full rounded-[var(--radius-control)] border p-3 text-[1rem] leading-relaxed outline-none", blocked.length ? "border-late" : "border-rule-strong focus:border-accent")}
      />
      <p className="mt-1 text-2xs text-ink-2">{t("reminderFromTemplate", { purpose: t(`purpose_${purpose}` as MessageKey) })}</p>
      <div className="mt-3 space-y-2">
        {blocked.length > 0 && <Banner tone="late" icon={<TriangleAlert className="size-4" />}>{t("reminderBlocked", { words: blocked.join(", ") })}</Banner>}
        {tooLong && <Banner tone="due">{t("reminderTooLong", { n: MAX_MESSAGE_LENGTH })}</Banner>}
        {!win.open && <Banner tone="late" icon={<Lock className="size-4" />}>{t("messageClosed")}</Banner>}
      </div>
      <Button size="lg" className="mt-4 w-full" disabled={!canSend} onClick={() => template && onSend(template.id, msgLang, body.trim())} icon={<Send className="size-4" />}>
        {t("send")}
      </Button>
    </Sheet>
  );
}

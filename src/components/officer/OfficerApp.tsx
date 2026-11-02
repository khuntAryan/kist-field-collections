"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Clock, CloudOff, ListOrdered, RefreshCw, TriangleAlert } from "lucide-react";
import { Banner, Button, EmptyState, Skeleton, cx } from "@/components/ui";
import { translate, type Lang, type MessageKey } from "@/lib/i18n";
import { checkContactTime, contactWindowStatus } from "@/lib/contact-window";
import { formatShortDate, istDate } from "@/lib/time";
import type { AttemptEvent, MessageEvent, OutcomeEvent } from "@/lib/sync-protocol";
import type { OfficerDay, OfficerLoan } from "@/server/queries/officer";
import {
  addToOutbox,
  clearAll,
  getMeta,
  listOutbox,
  listRejected,
  removeFromOutbox,
  removeRejected,
  setMeta,
  type OutboxItem,
  type RejectedItem,
} from "@/client/officer/store";
import { pullDay, pushOutbox } from "@/client/officer/sync";
import { readLocation, type GpsReading } from "@/client/officer/geo";
import { LoanDetail, PromisesView, SyncPill, SyncView, TodayView, type LoanView } from "./views";
import { OutcomeSheet, ReminderSheet, type OutcomeDraft } from "./sheets";

type Tab = "today" | "promises" | "sync";
type View = { name: Tab } | { name: "loan"; id: string; from: Tab };
type SheetState = { kind: "outcome" | "reminder"; loanId: string } | null;
type Toast = { text: string; undoId?: string; tone?: "neutral" | "late" | "due" };

const UNDO_MS = 6000;
const PUSH_EVERY_MS = 20_000;
const FULL_REFRESH_MS = 5 * 60_000;

const uuid = () => crypto.randomUUID();

export function OfficerApp({ officer }: { officer: { id: string; name: string; language: Lang; branchName: string } }) {
  const [lang, setLangState] = useState<Lang>(officer.language);
  const t = useCallback((key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);

  const [day, setDay] = useState<OfficerDay | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [fromCache, setFromCache] = useState(false);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [rejected, setRejected] = useState<RejectedItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [view, setView] = useState<View>({ name: "today" });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [gps, setGps] = useState<GpsReading | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const lastCall = useRef<Record<string, number>>({});
  const refreshing = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetRef = useRef<SheetState>(null);
  const viewRef = useRef<View>(view);
  sheetRef.current = sheet;
  viewRef.current = view;

  const showToast = useCallback((toastValue: Toast, ms = UNDO_MS) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(toastValue);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const reloadLocal = useCallback(async () => {
    const [o, r, off, ls] = await Promise.all([listOutbox(officer.id), listRejected(officer.id), getMeta("serverOffsetMs"), getMeta("lastSync")]);
    setOutbox(o);
    setRejected(r);
    if (off !== undefined) setOffset(off);
    if (ls) setLastSync(ls);
  }, [officer.id]);

  /** Push saved entries first, then pull the fresh list. */
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setSyncing(true);
    try {
      const push = await pushOutbox(officer.id);
      if (push.status === "signed_out") {
        setSignedOut(true);
        setLoad((l) => (l === "loading" ? "error" : l));
        return;
      }
      if (push.rejected > 0) showToast({ text: t("needsAttention"), tone: "late" });
      const pull = await pullDay();
      if (pull.status === "ok" && pull.day) {
        setDay(pull.day);
        setFromCache(false);
        setSignedOut(false);
        setLoad("ready");
      } else {
        if (pull.status === "signed_out") setSignedOut(true);
        setLoad((l) => (l === "loading" ? "error" : l));
      }
    } finally {
      await reloadLocal();
      setSyncing(false);
      refreshing.current = false;
    }
  }, [officer.id, reloadLocal, showToast, t]);

  const pushSoon = useCallback(
    (delay = 300) => {
      setTimeout(async () => {
        const r = await pushOutbox(officer.id);
        if (r.status === "signed_out") setSignedOut(true);
        if (r.rejected > 0) showToast({ text: t("needsAttention"), tone: "late" });
        await reloadLocal();
        if (r.accepted > 0) {
          const pull = await pullDay();
          if (pull.status === "ok" && pull.day) setDay(pull.day);
        }
      }, delay);
    },
    [officer.id, reloadLocal, showToast, t],
  );

  // Start: show the phone's saved copy at once, then sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const owner = await getMeta("officerId");
      if (owner && owner !== officer.id) await clearAll();
      await setMeta("officerId", officer.id);
      const savedLang = await getMeta("lang");
      if (savedLang && !cancelled) setLangState(savedLang);
      const cached = await getMeta("day");
      if (cached && cached.officer.id === officer.id && !cancelled) {
        setDay(cached);
        setFromCache(true);
        setLoad("ready");
      }
      lastCall.current = (await getMeta("lastCall")) ?? {};
      await reloadLocal();
      setOnline(navigator.onLine);
      refresh();
    })();

    const goOnline = () => {
      setOnline(true);
      refresh();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => document.visibilityState === "visible" && navigator.onLine && refresh();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => {
      setClock(Date.now());
      if (navigator.onLine) pushSoon(0);
    }, PUSH_EVERY_MS);
    const full = setInterval(() => navigator.onLine && refresh(), FULL_REFRESH_MS);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
      clearInterval(full);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "hi" ? "hi-IN" : "en-IN";
  }, [lang]);

  // Android back button: close the sheet, then leave the borrower page.
  useEffect(() => {
    const onPop = () => {
      if (sheetRef.current) return setSheet(null);
      const v = viewRef.current;
      if (v.name === "loan") setView({ name: v.from });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const now = useMemo(() => new Date(clock + offset), [clock, offset]);
  const today = istDate(now);
  const win = contactWindowStatus(now);

  // The server list plus anything saved on the phone that has not synced yet.
  const loans: LoanView[] = useMemo(() => {
    if (!day) return [];
    return day.loans.map((l) => {
      const mine = outbox
        .filter((o) => o.event.loanId === l.id && o.event.kind === "outcome")
        .map((o) => o.event as OutcomeEvent)
        .filter((e) => istDate(new Date(new Date(e.occurredAt).getTime() + e.serverOffsetMs)) === today);
      const latest = mine[mine.length - 1];
      const promise = [...mine].reverse().find((e) => e.type === "promise");
      return {
        ...l,
        promise: promise ? { date: promise.promisedDate!, amount: promise.amount!, status: "open" as const } : l.promise,
        todayStatus: latest
          ? { type: latest.type, at: new Date(new Date(latest.occurredAt).getTime() + latest.serverOffsetMs).toISOString(), pending: true }
          : l.today && istDate(new Date(l.today.at)) === today
            ? { ...l.today, pending: false }
            : null,
      };
    });
  }, [day, outbox, today]);
  const loansById = useMemo(() => new Map(loans.map((l) => [l.id, l])), [loans]);

  const go = (tab: Tab) => {
    const wasLoan = view.name === "loan";
    viewRef.current = { name: tab };
    setView({ name: tab });
    if (wasLoan) history.back();
    window.scrollTo({ top: 0 });
  };
  const openLoan = (id: string) => {
    history.pushState({ kist: "loan" }, "");
    setView({ name: "loan", id, from: view.name === "loan" ? view.from : view.name });
    window.scrollTo({ top: 0 });
  };
  const openSheet = (s: NonNullable<SheetState>) => {
    history.pushState({ kist: "sheet" }, "");
    setSheet(s);
  };
  const closeSheet = () => {
    if (sheetRef.current) history.back();
  };

  const base = () => ({ deviceTime: new Date().toISOString(), serverOffsetMs: Math.round(offset), createdOffline: !navigator.onLine });

  const actions = {
    onOpen: openLoan,
    onMap: (loan: OfficerLoan) => {
      const q = loan.lat && loan.lng ? `${loan.lat},${loan.lng}` : encodeURIComponent(loan.address);
      window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
    },
    onCall: async (loan: OfficerLoan) => {
      const check = checkContactTime(new Date(Date.now() + offset));
      const id = uuid();
      const event: AttemptEvent = {
        id,
        kind: "attempt",
        loanId: loan.id,
        ...base(),
        attemptKind: "call",
        allowed: check.allowed,
        blockedReason: check.allowed ? undefined : check.reason,
      };
      await addToOutbox({ id, officerId: officer.id, event, createdAt: Date.now(), notBefore: Date.now() });
      await reloadLocal();
      pushSoon();
      if (!check.allowed) return showToast({ text: t("callBlocked"), tone: "late" });
      lastCall.current[loan.id] = Date.now();
      await setMeta("lastCall", lastCall.current);
      if (day?.demoMode) showToast({ text: t("callSimulated") });
      else window.location.href = `tel:+91${loan.phone}`;
    },
    onLog: (loan: OfficerLoan) => {
      setGps(null);
      readLocation().then(setGps);
      openSheet({ kind: "outcome", loanId: loan.id });
    },
  };

  const saveOutcome = async (loan: OfficerLoan, d: OutcomeDraft) => {
    const id = uuid();
    const deviceNow = new Date();
    const occurredDevice = new Date(Math.min(d.occurredAt.getTime() - offset, deviceNow.getTime()));
    const event: OutcomeEvent = {
      id,
      kind: "outcome",
      loanId: loan.id,
      ...base(),
      type: d.type,
      channel: d.channel,
      occurredAt: occurredDevice.toISOString(),
      reason: d.reason,
      amount: d.amount,
      promisedDate: d.promisedDate,
      note: d.note,
      gps: gps ?? { status: "timeout" },
    };
    await addToOutbox({ id, officerId: officer.id, event, createdAt: Date.now(), notBefore: Date.now() + UNDO_MS });
    closeSheet();
    await reloadLocal();
    showToast({ text: navigator.onLine ? t("saved") : t("savedOffline"), undoId: id });
    pushSoon(UNDO_MS + 300);
  };

  const undo = async (id: string) => {
    await removeFromOutbox([id]);
    await reloadLocal();
    showToast({ text: t("undone") }, 2500);
  };

  const sendReminder = async (loan: OfficerLoan, templateId: string, language: "hi" | "en", body: string) => {
    const id = uuid();
    const event: MessageEvent = { id, kind: "message", loanId: loan.id, ...base(), templateId, language, body };
    await addToOutbox({ id, officerId: officer.id, event, createdAt: Date.now(), notBefore: Date.now() });
    closeSheet();
    await reloadLocal();
    showToast({ text: t("reminderQueued") });
    pushSoon();
  };

  const setLang = async (l: Lang) => {
    setLangState(l);
    await setMeta("lang", l);
  };

  const signOut = async () => {
    try {
      await pushOutbox(officer.id);
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* offline: still clear the phone */
    }
    await clearAll();
    window.location.href = "/login";
  };

  const setDemoClock = async (time: string | null) => {
    await fetch("/api/demo-clock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ time }) });
    await refresh();
  };

  const dueToday = loans.filter((l) => l.promise && l.promise.status === "open" && l.promise.date === today).length;
  const sheetLoan = sheet ? loansById.get(sheet.loanId) : undefined;
  const defaultChannel = sheet && lastCall.current[sheet.loanId] && Date.now() - lastCall.current[sheet.loanId] < 20 * 60_000 ? "call" : "visit";

  const notices = (
    <>
      {day?.demoClock && <Banner tone="accent" icon={<Clock className="size-4" />}>{t("demoClockOn", { time: day.demoClock })}</Banner>}
      {signedOut && outbox.length > 0 && (
        <Banner tone="due" icon={<TriangleAlert className="size-4" />} action={<a className="font-semibold underline" href="/login">{t("signIn")}</a>}>
          {t("signedOutSync", { n: outbox.length })}
        </Banner>
      )}
      {fromCache && !online && <Banner tone="due" icon={<CloudOff className="size-4" />}>{t("cachedCopy")}</Banner>}
      {day?.fileDate && day.fileDate < today && <Banner tone="due" icon={<CalendarClock className="size-4" />}>{t("fileOld", { date: formatShortDate(day.fileDate, lang) })}</Banner>}
      {rejected.length > 0 && (
        <Banner tone="late" icon={<TriangleAlert className="size-4" />} action={<button className="font-semibold underline" onClick={() => go("sync")}>{t("syncTab")}</button>}>
          {t("needsAttention")} ({rejected.length})
        </Banner>
      )}
    </>
  );

  let body: React.ReactNode;
  if (!day && load === "loading") {
    body = (
      <div aria-busy="true" aria-label={t("loading")}>
        <div className="border-b border-rule bg-surface px-4 pt-4 pb-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-3 h-4 w-48" />
        </div>
        <ul className="mt-6 border-y border-rule bg-surface">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex gap-3 border-b border-rule px-4 py-4">
              <Skeleton className="h-7 w-6" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-11 w-full" />
              </div>
            </li>
          ))}
        </ul>
        <p className="sr-only">{t("loading")}</p>
      </div>
    );
  } else if (!day) {
    body = (
      <EmptyState
        title={signedOut ? t("signIn") : t("loadFailed")}
        body={signedOut ? t("signedOutSync", { n: outbox.length }) : undefined}
        action={signedOut ? <a href="/login" className="font-semibold text-accent underline">{t("signIn")}</a> : <Button onClick={refresh} busy={syncing}>{t("retry")}</Button>}
      />
    );
  } else if (view.name === "loan") {
    const loan = loansById.get(view.id);
    body = loan ? (
      <LoanDetail loan={loan} t={t} lang={lang} now={now} window={win} onBack={() => history.back()} actions={actions} onRemind={(l) => openSheet({ kind: "reminder", loanId: l.id })} />
    ) : (
      <EmptyState title={t("emptyListTitle")} action={<Button onClick={() => history.back()}>{t("back")}</Button>} />
    );
  } else if (view.name === "promises") {
    body = <PromisesView loans={loans} t={t} lang={lang} now={now} onOpen={openLoan} onRemind={(l) => openSheet({ kind: "reminder", loanId: l.id })} />;
  } else if (view.name === "sync") {
    body = (
      <SyncView
        t={t}
        lang={lang}
        online={online}
        syncing={syncing}
        signedOut={signedOut}
        lastSync={lastSync}
        outbox={outbox}
        rejected={rejected}
        loansById={loansById}
        onSync={refresh}
        onDismiss={async (id) => {
          await removeRejected(id);
          await reloadLocal();
        }}
        onLang={setLang}
        onSignOut={signOut}
        demoMode={day.demoMode}
        demoClock={day.demoClock}
        onDemoClock={setDemoClock}
      />
    );
  } else {
    body = (
      <TodayView
        t={t}
        lang={lang}
        now={now}
        officerName={day.officer.name}
        branchName={day.officer.branchName}
        loans={loans}
        fileDate={day.fileDate}
        window={win}
        header={<SyncPill online={online} pending={outbox.length} syncing={syncing} t={t} onClick={() => go("sync")} />}
        notices={notices}
        actions={actions}
      />
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number; tone?: string }[] = [
    { id: "today", label: t("today"), icon: <ListOrdered className="size-5" /> },
    { id: "promises", label: t("promisesTab"), icon: <CalendarClock className="size-5" />, badge: dueToday || undefined, tone: "bg-due" },
    { id: "sync", label: t("syncTab"), icon: <RefreshCw className="size-5" />, badge: outbox.length + rejected.length || undefined, tone: rejected.length ? "bg-late" : "bg-accent" },
  ];
  const activeTab: Tab = view.name === "loan" ? view.from : view.name;

  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-paper pb-24 shadow-[0_0_0_1px_var(--color-rule)]">
      <main>{body}</main>

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto flex max-w-lg justify-center px-4" role="status" aria-live="polite">
          <div
            className={cx(
              "animate-sheet flex w-full items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 text-[0.95rem] text-white shadow-lg",
              toast.tone === "late" ? "bg-late" : "bg-ink",
            )}
          >
            <span className="flex-1">{toast.text}</span>
            {toast.undoId && (
              <button onClick={() => undo(toast.undoId!)} className="h-9 shrink-0 rounded-md px-2 font-semibold text-[#b9c6f2] underline-offset-2 hover:underline">
                {t("undo")}
              </button>
            )}
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-rule bg-surface pb-safe" aria-label="Kist">
        <ul className="grid grid-cols-3">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <button
                onClick={() => go(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={cx("relative flex h-16 w-full flex-col items-center justify-center gap-0.5 text-sm font-semibold", activeTab === tab.id ? "text-accent" : "text-ink-2")}
              >
                <span className="relative">
                  {tab.icon}
                  {tab.badge ? (
                    <span className={cx("figure absolute -top-1.5 -right-3 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] text-white", tab.tone)}>{tab.badge}</span>
                  ) : null}
                </span>
                {tab.label}
                {activeTab === tab.id && <span className="absolute top-0 h-0.5 w-10 rounded-b bg-accent" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {sheet?.kind === "outcome" && sheetLoan && (
        <OutcomeSheet loan={sheetLoan} t={t} lang={lang} now={now} window={win} defaultChannel={defaultChannel} gps={gps} onSave={(d) => saveOutcome(sheetLoan, d)} onClose={closeSheet} />
      )}
      {sheet?.kind === "reminder" && sheetLoan && day && (
        <ReminderSheet
          loan={sheetLoan}
          templates={day.templates}
          t={t}
          lang={lang}
          now={now}
          window={win}
          officerName={day.officer.name}
          onSend={(id, l, b) => sendReminder(sheetLoan, id, l, b)}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

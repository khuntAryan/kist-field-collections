import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema, type DB } from "../db";
import {
  syncEvent,
  type SyncEvent,
  type SyncResult,
  type OutcomeEvent,
  type AttemptEvent,
  type MessageEvent,
} from "@/lib/sync-protocol";
import { checkContactTime, CLOCK_SKEW_FLAG_MS } from "@/lib/contact-window";
import { addDays, istDate } from "@/lib/time";
import { findBlockedPhrases } from "@/lib/templates";
import { evaluatePromise, MAX_PROMISE_DAYS } from "@/lib/promises";
import { audit } from "../audit";

const MAX_AGE_MS = 7 * 86_400_000;
const FUTURE_TOLERANCE_MS = 2 * 60_000;

type Officer = { id: string; role: string };

/**
 * Applies a batch of events from an officer's phone.
 * The server never trusts the phone's own checks: ownership, the contact window and
 * message wording are all checked again here, on corrected time.
 */
export async function applySync(
  officer: Officer,
  input: { clientNow: string; events: unknown[] },
  serverNow: Date,
  ip: string | null,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const valid: SyncEvent[] = [];

  for (const raw of input.events) {
    const parsed = syncEvent.safeParse(raw);
    const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : "unknown";
    if (!parsed.success) {
      results.push({ id, status: "rejected", reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid entry" });
    } else valid.push(parsed.data);
  }
  if (valid.length === 0) return results;

  valid.sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
  const skewNow = serverNow.getTime() - new Date(input.clientNow).getTime();

  await db.transaction(async (tx) => {
    const loanIds = [...new Set(valid.map((e) => e.loanId))];
    const current = await tx
      .select({ id: schema.loans.id, officer: schema.loans.assignedOfficerId })
      .from(schema.loans)
      .where(inArray(schema.loans.id, loanIds));
    const recent = await tx
      .selectDistinct({ id: schema.loanSnapshots.loanId })
      .from(schema.loanSnapshots)
      .where(
        and(
          inArray(schema.loanSnapshots.loanId, loanIds),
          eq(schema.loanSnapshots.officerId, officer.id),
          gte(schema.loanSnapshots.asOfDate, addDays(istDate(serverNow), -7)),
        ),
      );
    const mineNow = new Set(current.filter((l) => l.officer === officer.id).map((l) => l.id));
    const mineRecently = new Set(recent.map((r) => r.id));

    for (const e of valid) {
      const flags: string[] = [];
      if (Math.abs(skewNow - e.serverOffsetMs) > CLOCK_SKEW_FLAG_MS) flags.push("clock_changed");
      if (Math.abs(e.serverOffsetMs) > CLOCK_SKEW_FLAG_MS) flags.push("clock_skew");
      if (e.createdOffline) flags.push("offline");

      if (!mineNow.has(e.loanId)) {
        if (!mineRecently.has(e.loanId)) {
          results.push({ id: e.id, status: "rejected", reason: "not_your_loan", message: "This loan is not assigned to you." });
          continue;
        }
        flags.push("reassigned"); // the visit happened before the loan moved; keep the record
      }

      const contactAt = new Date(new Date(e.kind === "outcome" ? e.occurredAt : e.deviceTime).getTime() + e.serverOffsetMs);
      if (contactAt.getTime() > serverNow.getTime() + FUTURE_TOLERANCE_MS) {
        results.push({ id: e.id, status: "rejected", reason: "in_future", message: "The entry's time is in the future. Check the phone's clock." });
        continue;
      }
      if (serverNow.getTime() - contactAt.getTime() > MAX_AGE_MS) {
        results.push({ id: e.id, status: "rejected", reason: "too_old", message: "Entries older than 7 days must go through the branch manager." });
        continue;
      }

      const result =
        e.kind === "outcome"
          ? await applyOutcome(tx, officer, e, contactAt, flags)
          : e.kind === "attempt"
            ? await applyAttempt(tx, officer, e, contactAt, flags)
            : await applyMessage(tx, officer, e, contactAt, flags);
      results.push(result);
    }

    const accepted = results.filter((r) => r.status === "accepted").length;
    const rejected = results.filter((r) => r.status === "rejected");
    await audit(
      officer,
      "sync.batch",
      null,
      { received: input.events.length, accepted, rejected: rejected.length, reasons: rejected.map((r) => r.reason) },
      { tx, ip },
    );
  });

  return results;
}

async function recordBlocked(
  tx: DB,
  officer: Officer,
  e: { id: string; loanId: string },
  kind: "call" | "visit" | "message",
  at: Date,
  reason: "before_window" | "after_window",
  flags: string[],
) {
  await tx
    .insert(schema.contactAttempts)
    .values({ id: e.id, loanId: e.loanId, officerId: officer.id, kind, occurredAt: at, allowed: false, blockedReason: reason, flags })
    .onConflictDoNothing();
  await audit(officer, "contact.blocked", { type: "loan", id: e.loanId }, { kind, reason, at: at.toISOString(), flags }, { tx });
}

async function applyOutcome(tx: DB, officer: Officer, e: OutcomeEvent, at: Date, flags: string[]): Promise<SyncResult> {
  const window = checkContactTime(at);
  if (!window.allowed) {
    await recordBlocked(tx, officer, e, e.channel, at, window.reason, [...flags, "server_blocked"]);
    return { id: e.id, status: "rejected", reason: "outside_contact_window", message: "Contact is allowed only between 8 am and 7 pm.", flags };
  }

  const day = istDate(at);
  if (e.type === "promise" && e.promisedDate) {
    if (e.promisedDate < day || e.promisedDate > addDays(day, MAX_PROMISE_DAYS)) {
      return { id: e.id, status: "rejected", reason: "invalid", message: `Promise date must be within ${MAX_PROMISE_DAYS} days.` };
    }
  }

  const inserted = await tx
    .insert(schema.outcomes)
    .values({
      id: e.id,
      loanId: e.loanId,
      officerId: officer.id,
      type: e.type,
      channel: e.channel,
      reason: e.reason ?? null,
      amount: e.amount ?? null,
      promisedDate: e.promisedDate ?? null,
      note: e.note?.trim() || null,
      occurredAt: at,
      deviceTime: new Date(e.deviceTime),
      clockSkewMs: e.serverOffsetMs,
      lat: e.gps.lat ?? null,
      lng: e.gps.lng ?? null,
      accuracyM: e.gps.accuracy ?? null,
      gpsStatus: e.gps.status,
      createdOffline: e.createdOffline,
      flags,
    })
    .onConflictDoNothing()
    .returning({ id: schema.outcomes.id });
  if (inserted.length === 0) return { id: e.id, status: "duplicate" };

  if (e.type === "promise") {
    await tx
      .update(schema.promises)
      .set({ status: "superseded", resolvedAt: at })
      .where(and(eq(schema.promises.loanId, e.loanId), eq(schema.promises.status, "open")));
    await tx.insert(schema.promises).values({
      loanId: e.loanId,
      outcomeId: e.id,
      officerId: officer.id,
      promisedDate: e.promisedDate!,
      amount: e.amount!,
      status: "open",
      createdAt: at,
    });
  }

  if (e.type === "paid") {
    const open = await tx
      .select()
      .from(schema.promises)
      .where(and(eq(schema.promises.loanId, e.loanId), eq(schema.promises.status, "open")));
    for (const p of open) {
      const paid = await tx
        .select({
          amount: schema.outcomes.amount,
          date: sql<string>`(${schema.outcomes.occurredAt} at time zone 'Asia/Kolkata')::date::text`,
        })
        .from(schema.outcomes)
        .where(and(eq(schema.outcomes.loanId, e.loanId), eq(schema.outcomes.type, "paid")));
      const state = evaluatePromise(
        { madeOn: istDate(p.createdAt), promisedDate: p.promisedDate, amount: p.amount },
        paid.map((x) => ({ date: x.date, amount: x.amount ?? 0 })),
        day,
      );
      if (state === "kept") await tx.update(schema.promises).set({ status: "kept", resolvedAt: at }).where(eq(schema.promises.id, p.id));
    }
  }

  if (e.type === "dispute") {
    await tx.update(schema.loans).set({ disputed: true }).where(eq(schema.loans.id, e.loanId));
    await audit(officer, "loan.dispute_raised", { type: "loan", id: e.loanId }, { reason: e.reason }, { tx });
  }

  return { id: e.id, status: "accepted", flags };
}

async function applyAttempt(tx: DB, officer: Officer, e: AttemptEvent, at: Date, flags: string[]): Promise<SyncResult> {
  const window = checkContactTime(at);
  let allowed = e.allowed;
  let blockedReason = e.blockedReason ?? null;
  if (allowed && !window.allowed) {
    // The phone let it through (wrong clock?). Record it as a blocked attempt and flag it.
    allowed = false;
    blockedReason = window.reason;
    flags.push("server_corrected");
  }
  const inserted = await tx
    .insert(schema.contactAttempts)
    .values({ id: e.id, loanId: e.loanId, officerId: officer.id, kind: e.attemptKind, occurredAt: at, allowed, blockedReason, flags })
    .onConflictDoNothing()
    .returning({ id: schema.contactAttempts.id });
  if (inserted.length === 0) return { id: e.id, status: "duplicate" };
  if (!allowed) {
    await audit(officer, "contact.blocked", { type: "loan", id: e.loanId }, { kind: e.attemptKind, reason: blockedReason, flags }, { tx });
  }
  return { id: e.id, status: "accepted", flags };
}

async function applyMessage(tx: DB, officer: Officer, e: MessageEvent, at: Date, flags: string[]): Promise<SyncResult> {
  const [template] = await tx
    .select()
    .from(schema.messageTemplates)
    .where(and(eq(schema.messageTemplates.id, e.templateId), eq(schema.messageTemplates.active, true)));
  if (!template) return { id: e.id, status: "rejected", reason: "invalid", message: "That template is no longer approved." };

  const blockedWords = findBlockedPhrases(e.body);
  const window = checkContactTime(at);
  const status = blockedWords.length === 0 && window.allowed ? "sent_simulated" : "blocked";
  const blockedReason = blockedWords.length > 0 ? `words:${blockedWords.join(",")}` : window.allowed ? null : window.reason;

  const inserted = await tx
    .insert(schema.messages)
    .values({
      id: e.id,
      loanId: e.loanId,
      officerId: officer.id,
      templateId: e.templateId,
      language: e.language,
      body: e.body,
      status,
      blockedReason,
      occurredAt: at,
    })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  if (inserted.length === 0) return { id: e.id, status: "duplicate" };

  if (blockedWords.length > 0) {
    await audit(officer, "message.blocked_words", { type: "loan", id: e.loanId }, { words: blockedWords }, { tx });
    return { id: e.id, status: "rejected", reason: "blocked_words", message: `Not sent. Remove: ${blockedWords.join(", ")}` };
  }
  if (!window.allowed) {
    await audit(officer, "contact.blocked", { type: "loan", id: e.loanId }, { kind: "message", reason: window.reason }, { tx });
    return { id: e.id, status: "rejected", reason: "outside_contact_window", message: "Messages can go out only between 8 am and 7 pm." };
  }
  return { id: e.id, status: "accepted", flags };
}

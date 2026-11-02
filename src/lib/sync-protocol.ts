import { z } from "zod";
import { isISODate } from "./time";

/**
 * What the phone sends when it syncs. Each event has an id made on the phone, so sending
 * the same batch twice (a timeout, a retry, a flaky network) never creates duplicates.
 */

export const NOT_REACHABLE_REASONS = ["no_answer", "switched_off", "shop_closed", "wrong_number"] as const;
export const DISPUTE_REASONS = ["amount_wrong", "already_paid", "other"] as const;
export const PAID_REASONS = ["emi", "overdue_full", "partial"] as const;

const isoDateTime = z.iso.datetime({ offset: true });
const loanId = z.string().regex(/^LN-\d{3,8}$/);

const base = {
  id: z.uuid(),
  loanId,
  /** Phone clock when the officer tapped. */
  deviceTime: isoDateTime,
  /** Server time minus phone time, measured at the last sync. Bounded to a week. */
  serverOffsetMs: z.number().int().min(-7 * 86_400_000).max(7 * 86_400_000),
  createdOffline: z.boolean(),
};

const gps = z.object({
  status: z.enum(["ok", "denied", "unavailable", "timeout"]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(100_000).optional(),
});

export const outcomeEvent = z
  .object({
    ...base,
    kind: z.literal("outcome"),
    type: z.enum(["paid", "promise", "not_reachable", "dispute"]),
    channel: z.enum(["visit", "call"]),
    /** When the contact happened on the phone clock. Same as deviceTime unless logged later. */
    occurredAt: isoDateTime,
    reason: z.string().max(40).optional(),
    amount: z.number().int().positive().max(100_000_000).optional(),
    promisedDate: z.string().refine(isISODate, "Use YYYY-MM-DD").optional(),
    note: z.string().max(280).optional(),
    gps,
  })
  .superRefine((e, ctx) => {
    if (e.type === "paid" && !e.amount) ctx.addIssue({ code: "custom", path: ["amount"], message: "Paid needs an amount" });
    if (e.type === "promise" && (!e.promisedDate || !e.amount))
      ctx.addIssue({ code: "custom", path: ["promisedDate"], message: "Promise needs a date and amount" });
    if (e.type === "not_reachable" && !NOT_REACHABLE_REASONS.includes(e.reason as never))
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Pick why the borrower was not reachable" });
    if (e.type === "dispute" && !DISPUTE_REASONS.includes(e.reason as never))
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Pick what the dispute is about" });
    if (new Date(e.occurredAt).getTime() > new Date(e.deviceTime).getTime() + 60_000)
      ctx.addIssue({ code: "custom", path: ["occurredAt"], message: "A contact cannot happen after it is logged" });
  });

export const attemptEvent = z.object({
  ...base,
  kind: z.literal("attempt"),
  attemptKind: z.enum(["call", "visit", "message"]),
  allowed: z.boolean(),
  blockedReason: z.enum(["before_window", "after_window"]).optional(),
});

export const messageEvent = z.object({
  ...base,
  kind: z.literal("message"),
  templateId: z.string().max(60),
  language: z.enum(["hi", "en"]),
  body: z.string().min(1).max(480),
});

export const syncEvent = z.discriminatedUnion("kind", [outcomeEvent, attemptEvent, messageEvent]);
export type SyncEvent = z.infer<typeof syncEvent>;
export type OutcomeEvent = z.infer<typeof outcomeEvent>;
export type AttemptEvent = z.infer<typeof attemptEvent>;
export type MessageEvent = z.infer<typeof messageEvent>;

export const MAX_BATCH = 200;

export const syncRequest = z.object({
  clientNow: isoDateTime,
  events: z.array(z.unknown()).max(MAX_BATCH),
});

export type SyncResultStatus = "accepted" | "duplicate" | "rejected";
export type SyncRejectReason =
  | "invalid"
  | "not_your_loan"
  | "outside_contact_window"
  | "in_future"
  | "too_old"
  | "blocked_words";

export type SyncResult = {
  id: string;
  status: SyncResultStatus;
  reason?: SyncRejectReason;
  message?: string;
  flags?: string[];
};

export type SyncResponse = { serverNow: string; results: SyncResult[] };

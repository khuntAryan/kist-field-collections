"use client";
import type { OfficerDay } from "@/server/queries/officer";
import type { SyncResponse } from "@/lib/sync-protocol";
import { getMeta, listOutbox, moveToRejected, removeFromOutbox, setMeta } from "./store";

export type SyncStatus = "ok" | "offline" | "signed_out" | "error";

const TIMEOUT_MS = 12_000;

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal, credentials: "same-origin", cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** Server time minus phone time, from the middle of the request's round trip. */
function offsetFrom(serverNowIso: string, sentAt: number, receivedAt: number) {
  return new Date(serverNowIso).getTime() - (sentAt + receivedAt) / 2;
}

let running: Promise<{ status: SyncStatus; accepted: number; rejected: number }> | null = null;

/** Sends saved entries. Safe to call often: only one sync runs at a time. */
export function pushOutbox(officerId: string) {
  if (!running) {
    running = doPush(officerId).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doPush(officerId: string): Promise<{ status: SyncStatus; accepted: number; rejected: number }> {
  const ready = (await listOutbox(officerId)).filter((i) => i.notBefore <= Date.now()).slice(0, 200);
  if (ready.length === 0) return { status: "ok", accepted: 0, rejected: 0 };
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/officer/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientNow: new Date().toISOString(), events: ready.map((i) => i.event) }),
    });
  } catch {
    return { status: "offline", accepted: 0, rejected: 0 };
  }
  if (res.status === 401) return { status: "signed_out", accepted: 0, rejected: 0 };
  if (!res.ok) return { status: "error", accepted: 0, rejected: 0 };

  const body = (await res.json()) as SyncResponse;
  await setMeta("serverOffsetMs", offsetFrom(body.serverNow, sentAt, Date.now()));
  const done = body.results.filter((r) => r.status === "accepted" || r.status === "duplicate").map((r) => r.id);
  const rejected = body.results.filter((r) => r.status === "rejected");
  await removeFromOutbox(done);
  await moveToRejected(
    rejected
      .map((r) => {
        const item = ready.find((i) => i.id === r.id);
        return item ? { id: r.id, officerId, event: item.event, reason: r.reason ?? "invalid", message: r.message ?? "", at: Date.now() } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  );
  await setMeta("lastSync", Date.now());
  // More waiting (a big offline backlog)? Send the next batch.
  const more = (await listOutbox(officerId)).some((i) => i.notBefore <= Date.now());
  if (more && done.length > 0) {
    const next = await doPush(officerId);
    return { status: next.status, accepted: done.length + next.accepted, rejected: rejected.length + next.rejected };
  }
  return { status: "ok", accepted: done.length, rejected: rejected.length };
}

export async function pullDay(): Promise<{ status: SyncStatus; day?: OfficerDay }> {
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/officer/day");
  } catch {
    return { status: "offline" };
  }
  if (res.status === 401) return { status: "signed_out" };
  if (!res.ok) return { status: "error" };
  const day = (await res.json()) as OfficerDay;
  await setMeta("serverOffsetMs", offsetFrom(day.serverNow, sentAt, Date.now()));
  await setMeta("day", day);
  await setMeta("lastSync", Date.now());
  return { status: "ok", day };
}

export async function trustedNow(): Promise<Date> {
  const offset = (await getMeta("serverOffsetMs")) ?? 0;
  return new Date(Date.now() + offset);
}

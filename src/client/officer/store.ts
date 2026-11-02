"use client";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SyncEvent } from "@/lib/sync-protocol";
import type { OfficerDay } from "@/server/queries/officer";

/**
 * Everything the officer app keeps on the phone. IndexedDB survives the app being closed,
 * the phone restarting and hours without signal; in-memory retries would not.
 */
export type OutboxItem = { id: string; officerId: string; event: SyncEvent; createdAt: number; notBefore: number };
export type RejectedItem = { id: string; officerId: string; event: SyncEvent; reason: string; message: string; at: number };

type Meta = {
  day: OfficerDay;
  lastSync: number;
  serverOffsetMs: number;
  lang: "hi" | "en";
  officerId: string;
  lastCall: Record<string, number>;
};

interface KistDB extends DBSchema {
  meta: { key: string; value: unknown };
  outbox: { key: string; value: OutboxItem; indexes: { byOfficer: string } };
  rejected: { key: string; value: RejectedItem };
}

let dbPromise: Promise<IDBPDatabase<KistDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<KistDB>("kist-officer", 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("byOfficer", "officerId");
        db.createObjectStore("rejected", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function getMeta<K extends keyof Meta>(key: K): Promise<Meta[K] | undefined> {
  return (await (await getDb()).get("meta", key)) as Meta[K] | undefined;
}

export async function setMeta<K extends keyof Meta>(key: K, value: Meta[K]) {
  await (await getDb()).put("meta", value, key);
}

export async function listOutbox(officerId: string): Promise<OutboxItem[]> {
  const items = await (await getDb()).getAllFromIndex("outbox", "byOfficer", officerId);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addToOutbox(item: OutboxItem) {
  await (await getDb()).put("outbox", item);
}

export async function removeFromOutbox(ids: string[]) {
  const db = await getDb();
  const tx = db.transaction("outbox", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function moveToRejected(items: RejectedItem[]) {
  const db = await getDb();
  const tx = db.transaction(["outbox", "rejected"], "readwrite");
  for (const item of items) {
    await tx.objectStore("rejected").put(item);
    await tx.objectStore("outbox").delete(item.id);
  }
  await tx.done;
}

export async function listRejected(officerId: string): Promise<RejectedItem[]> {
  const all = await (await getDb()).getAll("rejected");
  return all.filter((r) => r.officerId === officerId).sort((a, b) => b.at - a.at);
}

export async function removeRejected(id: string) {
  await (await getDb()).delete("rejected", id);
}

/** Sign-out wipes borrower data from the phone (DPDP: keep personal data only as long as needed). */
export async function clearAll() {
  const db = await getDb();
  const tx = db.transaction(["meta", "outbox", "rejected"], "readwrite");
  await Promise.all([tx.objectStore("meta").clear(), tx.objectStore("outbox").clear(), tx.objectStore("rejected").clear(), tx.done]);
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("kist-pages")).map((k) => caches.delete(k)));
  }
}

import "server-only";
import { db, schema, type DB } from "./db";

type Actor = { id: string; role: string } | null;

/** Append-only record of who did what. Required for DPDP accountability. */
export async function audit(
  actor: Actor,
  action: string,
  entity: { type: string; id: string } | null,
  meta: Record<string, unknown> = {},
  opts: { ip?: string | null; tx?: DB } = {},
) {
  await (opts.tx ?? db).insert(schema.auditLog).values({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? "system",
    action,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    meta,
    ip: opts.ip ?? null,
  });
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

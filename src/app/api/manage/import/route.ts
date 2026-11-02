import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, HttpError } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { commitImport, previewImport } from "@/server/services/import";
import { latestFileDate } from "@/server/queries/manage";
import { MAX_IMPORT_BYTES } from "@/lib/csv-import";
import { isISODate, istDate } from "@/lib/time";
import { clientIp, audit } from "@/server/audit";
import { handle, readJson } from "@/server/http";

const body = z.object({
  mode: z.enum(["preview", "commit"]),
  fileName: z.string().min(1).max(120).regex(/\.csv$/i, "Upload a .csv file"),
  asOfDate: z.string().refine(isISODate, "Use YYYY-MM-DD"),
  csvText: z.string().min(1).max(MAX_IMPORT_BYTES),
  confirmLargeCure: z.boolean().optional(),
});

export const POST = handle(async (request: Request) => {
  const user = await requireApiUser(request, ["manager", "head"]);
  const input = body.parse(await readJson(request, MAX_IMPORT_BYTES + 10_000));
  const scope = await currentScope(user);
  const at = await now();
  const today = istDate(at);
  if (input.asOfDate > today) throw new HttpError(400, "future_date", "The file date cannot be in the future.");
  const latest = await latestFileDate(scope);
  if (latest && input.asOfDate < latest)
    throw new HttpError(400, "older_than_latest", `A file for ${latest} is already imported. Import that date again or a later one.`);

  const opts = {
    csvText: input.csvText,
    fileName: input.fileName,
    asOfDate: input.asOfDate,
    branchScope: scope,
    actor: { id: user.id, role: user.role },
    now: at,
    confirmLargeCure: input.confirmLargeCure,
  };
  const summary = input.mode === "preview" ? await previewImport(opts) : await commitImport(opts);
  if (input.mode === "preview") {
    await audit(user, "import.preview", null, { fileName: input.fileName, accepted: summary.accepted, rejected: summary.errors.length }, { ip: clientIp(request) });
  }
  return NextResponse.json(summary);
});

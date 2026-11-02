import { and, eq, sql } from "drizzle-orm";
import { requireApiUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { db, schema } from "@/server/db";
import { istDate } from "@/lib/time";
import { audit } from "@/server/audit";
import { handle } from "@/server/http";

const esc = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * A realistic morning file to try the import with: today's overdue book, minus five loans
 * that paid up overnight, plus four new overdue loans and three rows with mistakes.
 */
export const GET = handle(async (request: Request) => {
  const user = await requireApiUser(request, ["manager", "head"]);
  const scope = await currentScope(user);
  const today = istDate(await now());
  const rows = await db
    .select({ l: schema.loans, b: schema.borrowers })
    .from(schema.loans)
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .where(and(eq(schema.loans.status, "overdue"), scope ? eq(schema.loans.branchId, scope) : sql`true`))
    .orderBy(schema.loans.id);
  const keep = rows.filter((_, i) => i % Math.max(2, Math.floor(rows.length / 5)) !== 1 || i > rows.length - 2);
  const branch = scope ?? "IDR";
  const pin = branch === "PTP" ? "454775" : branch === "DWS" ? "455001" : "452010";
  const city = branch === "PTP" ? "Pithampur" : branch === "DWS" ? "Dewas" : "Indore";
  const header = "loan_id,borrower_name,business_type,contact_name,phone,address,pincode,branch,outstanding,emi,dpd,last_payment_date,paid_on_time_last_6,language";
  const lines = keep.map(({ l, b }) =>
    [l.id, b.name, b.businessType, b.contactName, b.phone, b.address, b.pincode, l.branchId, l.outstanding, l.emi, l.dpd, l.lastPaymentDate, l.paidRatio6m === null ? "" : Math.round(l.paidRatio6m * 6), b.language].map(esc).join(","),
  );
  const newRows = [
    ["LN-12901", "Company NEW1", "auto parts", "K. Jain", "9826012345", `Plot 12, AB Road, ${city} ${pin}`, pin, branch, "3,85,000", "13200", 3, "", 6, "hi"],
    ["LN-12902", "Company NEW2", "namkeen maker", "S. Verma", "+91 94250 22334", `Plot 88, Main Market, ${city} ${pin}`, pin, branch, "540000", "18900", 1, "", 5, "hi"],
    ["LN-12903", "Company NEW3", "garment unit", "R. Soni", "07000123456", `Plot 5, Station Road, ${city} ${pin}`, pin, branch, "2,10,000", "7400", 2, "", "", "en"],
    ["LN-12904", "Company NEW4", "dairy", "M. Khan", "9993012121", `Plot 41, Industrial Area, ${city} ${pin}`, pin, branch, "760000", "26600", 5, "", 4, "hi"],
  ].map((r) => r.map(esc).join(","));
  const badRows = [
    ["LN-12905", "Company BAD1", "tiles dealer", "P. Rathore", "12345", `Plot 9, ${city}`, pin, branch, "300000", "10500", 4, "", 5, "hi"],
    ["LN-12906", "Company BAD2", "pump repair", "A. Gupta", "9826099999", `Plot 2, ${city}`, "4520", branch, "0", "9000", 0, "", 5, "hi"],
    [keep[0]?.l.id ?? "LN-10050", "Duplicate row", "", "X", "9826011111", "Somewhere", pin, branch, "100000", "3000", 9, "", 5, "hi"],
  ].map((r) => r.map(esc).join(","));
  await audit(user, "import.sample_downloaded", null, { rows: lines.length });
  const csv = [header, ...lines, ...newRows, ...badRows].join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="overdue-${today}-sample.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

import { describe, expect, it } from "vitest";
import { parseOverdueCsv, parseAmount, parsePhone, parseDate, normaliseHeader } from "@/lib/csv-import";

const header = "loan_id,borrower_name,contact_name,phone,address,pincode,branch,outstanding,emi,dpd,last_payment_date,paid_on_time_last_6";
const good = 'LN-10293,Company B (packaging unit),A. Sharma,98270 11223,"12 Sector F, Sanwer Rd",452015,IDR,"6,40,000",21000,12,2026-09-20,5';

describe("field parsers", () => {
  it("reads Indian-format amounts", () => {
    expect(parseAmount("₹6,40,000")).toBe(640000);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-500")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("normalises phone numbers", () => {
    expect(parsePhone("+91 98270 11223")).toBe("9827011223");
    expect(parsePhone("09827011223")).toBe("9827011223");
    expect(parsePhone("12345")).toBeNull();
    expect(parsePhone("5827011223")).toBeNull(); // Indian mobiles start 6-9
  });
  it("reads day-first dates", () => {
    expect(parseDate("05/11/2026")).toBe("2026-11-05");
    expect(parseDate("31-02-2026")).toBeNull();
  });
  it("maps common header names", () => {
    expect(normaliseHeader("Loan No")).toBe("loan_id");
    expect(normaliseHeader("﻿Days Past Due")).toBe("dpd");
  });
});

describe("overdue CSV", () => {
  it("accepts a valid row", () => {
    const r = parseOverdueCsv(`${header}\n${good}`, ["IDR"]);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ loanId: "LN-10293", outstanding: 640000, dpd: 12, phone: "9827011223", paidOnTimeLast6: 5 });
  });

  it("reports missing columns instead of guessing", () => {
    const r = parseOverdueCsv("loan_id,dpd\nLN-1,4", ["IDR"]);
    expect(r.missingColumns).toContain("phone");
    expect(r.rows).toEqual([]);
  });

  it("rejects bad rows with line numbers and keeps the good ones", () => {
    const bad = "LN-2,Company X,Someone,12345,Addr,45201,ZZZ,abc,100,0,,";
    const r = parseOverdueCsv(`${header}\n${good}\n${bad}`, ["IDR"]);
    expect(r.rows.length).toBe(1);
    expect(r.errors[0].line).toBe(3);
    expect(r.errors[0].messages).toEqual(
      expect.arrayContaining([
        "Loan ID must look like LN-10293",
        "Phone must be a 10-digit Indian mobile number",
        "Pincode must be 6 digits",
        'Unknown branch "ZZZ"',
        "Outstanding must be a positive amount",
        "DPD is 0, so the loan is not overdue",
      ]),
    );
  });

  it("rejects duplicate loan IDs", () => {
    const r = parseOverdueCsv(`${header}\n${good}\n${good}`, ["IDR"]);
    expect(r.rows.length).toBe(1);
    expect(r.errors[0].messages).toContain("Loan ID appears more than once in this file");
  });

  it("rejects a last payment date after the file date", () => {
    const r = parseOverdueCsv(`${header}\n${good.replace("2026-09-20", "2026-12-01")}`, ["IDR"], "2026-11-02");
    expect(r.errors[0].messages).toContain("Last payment date is after the file date");
  });
});

import Papa from "papaparse";
import { isISODate } from "./time";

/**
 * Parses and validates the morning overdue export from the loan system.
 * Bad rows are reported with their line number and skipped; good rows can still be imported.
 */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export type ImportRow = {
  line: number;
  loanId: string;
  borrowerName: string;
  contactName: string;
  phone: string;
  address: string;
  pincode: string;
  branchId: string;
  outstanding: number;
  emi: number;
  dpd: number;
  lastPaymentDate: string | null;
  paidOnTimeLast6: number | null;
  businessType: string;
  language: "hi" | "en";
};

export type RowError = { line: number; loanId?: string; messages: string[] };

export type ParseResult = {
  rows: ImportRow[];
  errors: RowError[];
  totalRows: number;
  missingColumns: string[];
};

const REQUIRED = [
  "loan_id",
  "borrower_name",
  "contact_name",
  "phone",
  "address",
  "pincode",
  "branch",
  "outstanding",
  "emi",
  "dpd",
] as const;

const ALIASES: Record<string, string> = {
  loan_no: "loan_id",
  loan_number: "loan_id",
  loanid: "loan_id",
  borrower: "borrower_name",
  business_name: "borrower_name",
  contact: "contact_name",
  contact_person: "contact_name",
  mobile: "phone",
  mobile_no: "phone",
  phone_number: "phone",
  pin: "pincode",
  pin_code: "pincode",
  branch_code: "branch",
  branch_id: "branch",
  outstanding_amount: "outstanding",
  os: "outstanding",
  principal_outstanding: "outstanding",
  emi_amount: "emi",
  days_past_due: "dpd",
  last_payment: "last_payment_date",
  paid_on_time_6m: "paid_on_time_last_6",
};

export function normaliseHeader(h: string): string {
  const key = h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return ALIASES[key] ?? key;
}

/** "₹6,40,000" or "640000.00" -> 640000. Returns null when it is not a positive amount. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned));
  return n > 0 && n <= 100_000_000 ? n : null;
}

/** Accepts 98765 43210, +91 9876543210, 09876543210. Returns the 10-digit number or null. */
export function parsePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** Accepts 2026-11-05, 05-11-2026 and 05/11/2026 (Indian day-first). */
export function parseDate(raw: string): string | null {
  const v = raw.trim();
  if (isISODate(v)) return v;
  const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

const clean = (v: string | undefined, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function parseOverdueCsv(text: string, knownBranches: string[], asOfDate?: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normaliseHeader,
  });

  const fields = parsed.meta.fields ?? [];
  const missingColumns = REQUIRED.filter((c) => !fields.includes(c));
  if (missingColumns.length > 0) {
    return { rows: [], errors: [], totalRows: parsed.data.length, missingColumns };
  }

  const branchSet = new Set(knownBranches.map((b) => b.toUpperCase()));
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const errors: RowError[] = [];

  parsed.data.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const line = i + 2; // header is line 1
    const messages: string[] = [];
    const loanId = clean(r.loan_id, 40).toUpperCase();

    if (!/^LN-\d{3,8}$/.test(loanId)) messages.push("Loan ID must look like LN-10293");
    else if (seen.has(loanId)) messages.push("Loan ID appears more than once in this file");

    const borrowerName = clean(r.borrower_name, 120);
    if (!borrowerName) messages.push("Borrower name is empty");
    const contactName = clean(r.contact_name, 80);
    if (!contactName) messages.push("Contact name is empty");

    const phone = parsePhone(r.phone ?? "");
    if (!phone) messages.push("Phone must be a 10-digit Indian mobile number");

    const address = clean(r.address, 300);
    if (!address) messages.push("Address is empty");

    const pincode = clean(r.pincode, 10);
    if (!/^[1-9]\d{5}$/.test(pincode)) messages.push("Pincode must be 6 digits");

    const branchId = clean(r.branch, 10).toUpperCase();
    if (!branchSet.has(branchId)) messages.push(`Unknown branch "${branchId || "(empty)"}"`);

    const outstanding = parseAmount(r.outstanding ?? "");
    if (outstanding === null) messages.push("Outstanding must be a positive amount");
    const emi = parseAmount(r.emi ?? "");
    if (emi === null) messages.push("EMI must be a positive amount");

    const dpdRaw = clean(r.dpd, 6);
    const dpd = /^\d+$/.test(dpdRaw) ? Number(dpdRaw) : NaN;
    if (Number.isNaN(dpd)) messages.push("DPD must be a whole number");
    else if (dpd < 1) messages.push("DPD is 0, so the loan is not overdue");
    else if (dpd > 365) messages.push("DPD above 365 is handled by the legal team, not field collections");

    let lastPaymentDate: string | null = null;
    if (clean(r.last_payment_date, 20)) {
      lastPaymentDate = parseDate(r.last_payment_date);
      if (!lastPaymentDate) messages.push("Last payment date must be YYYY-MM-DD or DD-MM-YYYY");
      else if (asOfDate && lastPaymentDate > asOfDate) messages.push("Last payment date is after the file date");
    }

    let paidOnTimeLast6: number | null = null;
    const p6 = clean(r.paid_on_time_last_6, 3);
    if (p6) {
      paidOnTimeLast6 = /^[0-6]$/.test(p6) ? Number(p6) : null;
      if (paidOnTimeLast6 === null) messages.push("Paid on time (last 6) must be 0 to 6");
    }

    if (messages.length > 0) {
      errors.push({ line, loanId: loanId || undefined, messages });
      if (/^LN-\d{3,8}$/.test(loanId)) seen.add(loanId);
      return;
    }
    seen.add(loanId);
    const language = clean(r.language, 2).toLowerCase() === "en" ? "en" : "hi";
    rows.push({
      line,
      loanId,
      borrowerName,
      contactName,
      phone: phone!,
      address,
      pincode,
      branchId,
      outstanding: outstanding!,
      emi: emi!,
      dpd,
      lastPaymentDate,
      paidOnTimeLast6,
      businessType: clean(r.business_type, 60),
      language,
    });
  });

  return { rows, errors, totalRows: parsed.data.length, missingColumns: [] };
}

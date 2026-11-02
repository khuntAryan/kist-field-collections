import { describe, expect, it } from "vitest";
import { assignLoans, type AssignLoan, type AssignOfficer } from "@/lib/assignment";

const officers: AssignOfficer[] = [
  { id: "rahul", name: "Rahul", branchId: "IDR", active: true, maxLoad: 3, pincodes: ["452001", "452002"] },
  { id: "neha", name: "Neha", branchId: "IDR", active: true, maxLoad: 3, pincodes: ["452002", "452010"] },
  { id: "imran", name: "Imran", branchId: "PTP", active: true, maxLoad: 3, pincodes: ["454775"] },
];

const loan = (id: string, pincode: string, extra: Partial<AssignLoan> = {}): AssignLoan => ({
  id,
  branchId: pincode.startsWith("454") ? "PTP" : "IDR",
  pincode,
  outstanding: 300_000,
  score: 50,
  currentOfficerId: null,
  ...extra,
});

describe("auto-assignment", () => {
  it("assigns by pincode", () => {
    const [a] = assignLoans([loan("LN-1", "452010")], officers);
    expect(a).toEqual({ loanId: "LN-1", officerId: "neha", reason: "pincode_match" });
  });

  it("balances workload when two officers cover the pincode", () => {
    const res = assignLoans([loan("LN-1", "452002"), loan("LN-2", "452002")], officers);
    expect(new Set(res.map((r) => r.officerId))).toEqual(new Set(["rahul", "neha"]));
  });

  it("keeps a borrower with their current officer", () => {
    const [a] = assignLoans([loan("LN-1", "452010", { currentOfficerId: "rahul" })], officers);
    expect(a.officerId).toBe("rahul");
    expect(a.reason).toBe("kept_with_officer");
  });

  it("falls back to anyone in the branch when no one covers the pincode", () => {
    const [a] = assignLoans([loan("LN-1", "452099")], officers);
    expect(a.reason).toBe("branch_fallback");
    expect(["rahul", "neha"]).toContain(a.officerId);
  });

  it("never crosses branches", () => {
    const res = assignLoans([loan("LN-1", "454775")], officers.filter((o) => o.id !== "imran"));
    expect(res[0]).toMatchObject({ officerId: null, reason: "no_officer" });
  });

  it("respects max load and leaves the lowest-priority loans for the manager", () => {
    const loans = Array.from({ length: 5 }, (_, i) => loan(`LN-${i}`, "454775", { score: 90 - i * 10 }));
    const res = assignLoans(loans, officers);
    const assigned = res.filter((r) => r.officerId === "imran").map((r) => r.loanId);
    expect(assigned).toEqual(["LN-0", "LN-1", "LN-2"]);
    expect(res.filter((r) => r.reason === "all_full").map((r) => r.loanId)).toEqual(["LN-3", "LN-4"]);
  });

  it("skips inactive officers", () => {
    const res = assignLoans([loan("LN-1", "452010", { currentOfficerId: "neha" })], officers.map((o) => (o.id === "neha" ? { ...o, active: false } : o)));
    expect(res[0].officerId).toBe("rahul");
  });
});

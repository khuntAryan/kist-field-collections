/**
 * Auto-assignment of overdue loans to field officers.
 *
 * Rules, in order:
 * 1. Continuity: a loan stays with its current officer if that officer is active, in the same
 *    branch and has room. Borrowers keep talking to the same person.
 * 2. Pincode: otherwise it goes to an officer who covers the borrower's pincode.
 * 3. Branch fallback: if no officer covers the pincode, any officer in the branch.
 * 4. Workload: among candidates, the one with the fewest loans so far; ties go to the one
 *    with the smaller total outstanding, then by name so results are repeatable.
 * 5. Capacity: an officer at their max load gets no new loans. If everyone is full,
 *    the loan is left unassigned for the branch manager.
 *
 * Loans are placed highest-priority first, so if capacity runs out it is the
 * lower-priority loans that wait for the manager.
 */

export type AssignOfficer = {
  id: string;
  name: string;
  branchId: string;
  active: boolean;
  maxLoad: number;
  pincodes: string[];
};

export type AssignLoan = {
  id: string;
  branchId: string;
  pincode: string;
  outstanding: number;
  score: number;
  currentOfficerId: string | null;
};

export type AssignmentReason = "kept_with_officer" | "pincode_match" | "branch_fallback" | "no_officer" | "all_full";

export type Assignment = {
  loanId: string;
  officerId: string | null;
  reason: AssignmentReason;
};

export function assignLoans(loans: AssignLoan[], officers: AssignOfficer[]): Assignment[] {
  const active = officers.filter((o) => o.active);
  const byId = new Map(active.map((o) => [o.id, o]));
  const load = new Map<string, number>(active.map((o) => [o.id, 0]));
  const exposure = new Map<string, number>(active.map((o) => [o.id, 0]));

  const ordered = [...loans].sort((a, b) => b.score - a.score || b.outstanding - a.outstanding || a.id.localeCompare(b.id));
  const result: Assignment[] = [];

  const hasRoom = (o: AssignOfficer) => (load.get(o.id) ?? 0) < o.maxLoad;
  const give = (loan: AssignLoan, officer: AssignOfficer, reason: AssignmentReason) => {
    load.set(officer.id, (load.get(officer.id) ?? 0) + 1);
    exposure.set(officer.id, (exposure.get(officer.id) ?? 0) + loan.outstanding);
    result.push({ loanId: loan.id, officerId: officer.id, reason });
  };
  const leastLoaded = (candidates: AssignOfficer[]) =>
    [...candidates].sort(
      (a, b) =>
        (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
        (exposure.get(a.id) ?? 0) - (exposure.get(b.id) ?? 0) ||
        a.name.localeCompare(b.name),
    )[0];

  // Pass 1: continuity, so existing relationships are not broken by new loans taking the room.
  const pending: AssignLoan[] = [];
  for (const loan of ordered) {
    const current = loan.currentOfficerId ? byId.get(loan.currentOfficerId) : undefined;
    if (current && current.branchId === loan.branchId && hasRoom(current)) {
      give(loan, current, "kept_with_officer");
    } else {
      pending.push(loan);
    }
  }

  // Pass 2: pincode match, then branch fallback.
  for (const loan of pending) {
    const inBranch = active.filter((o) => o.branchId === loan.branchId);
    if (inBranch.length === 0) {
      result.push({ loanId: loan.id, officerId: null, reason: "no_officer" });
      continue;
    }
    const covering = inBranch.filter((o) => o.pincodes.includes(loan.pincode));
    const coveringWithRoom = covering.filter(hasRoom);
    if (coveringWithRoom.length > 0) {
      give(loan, leastLoaded(coveringWithRoom), "pincode_match");
      continue;
    }
    const branchWithRoom = inBranch.filter(hasRoom);
    if (branchWithRoom.length > 0) {
      give(loan, leastLoaded(branchWithRoom), "branch_fallback");
      continue;
    }
    result.push({ loanId: loan.id, officerId: null, reason: "all_full" });
  }

  return result;
}

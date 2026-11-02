/**
 * Roll rate: of the loans that were 1-30 DPD on the start date, the share that are
 * 31+ DPD on the end date (30 days later by default). Loans that paid up and left the
 * overdue file count as not rolled.
 */
export type RollSnapshot = { loanId: string; dpd: number; branchId: string };

export type RollResult = { cohort: number; rolled: number; rate: number | null };

export function computeRollRate(
  start: RollSnapshot[],
  end: RollSnapshot[],
): { overall: RollResult; byBranch: Record<string, RollResult> } {
  const endDpd = new Map(end.map((s) => [s.loanId, s.dpd]));
  const byBranch: Record<string, { cohort: number; rolled: number }> = {};
  let cohort = 0;
  let rolled = 0;
  for (const s of start) {
    if (s.dpd < 1 || s.dpd > 30) continue;
    const b = (byBranch[s.branchId] ??= { cohort: 0, rolled: 0 });
    b.cohort++;
    cohort++;
    if ((endDpd.get(s.loanId) ?? 0) >= 31) {
      b.rolled++;
      rolled++;
    }
  }
  const rate = (r: number, c: number) => (c === 0 ? null : r / c);
  return {
    overall: { cohort, rolled, rate: rate(rolled, cohort) },
    byBranch: Object.fromEntries(
      Object.entries(byBranch).map(([k, v]) => [k, { ...v, rate: rate(v.rolled, v.cohort) }]),
    ),
  };
}

/** Pick the latest available snapshot date on or before the target (imports can skip a day). */
export function nearestOnOrBefore(available: string[], target: string): string | null {
  let best: string | null = null;
  for (const d of available) if (d <= target && (best === null || d > best)) best = d;
  return best;
}

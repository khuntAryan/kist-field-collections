"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReassignControl({ loanId, current, officers, officerName }: { loanId: string; current: string | null; officers: { id: string; name: string }[]; officerName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function assign(officerId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/manage/loans/${loanId}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officerId }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? "Could not reassign.");
    router.refresh();
    setBusy(false);
  }
  return (
    <div className="rounded-[var(--radius-control)] border border-rule bg-surface px-4 py-3">
      <label className="block text-sm text-ink-2" htmlFor="reassign">
        Officer
      </label>
      <select id="reassign" value={current ?? ""} disabled={busy} onChange={(e) => assign(e.target.value)} className="mt-1 h-10 min-w-56 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-2 font-semibold">
        {!current && <option value="">Not assigned</option>}
        {officers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-late">{error}</p>}
      {!error && officerName && <p className="mt-1 text-2xs text-ink-3">Changing it moves the borrower to the new officer&rsquo;s list.</p>}
    </div>
  );
}

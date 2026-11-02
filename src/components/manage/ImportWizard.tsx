"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { Banner, Button, Chip, cx } from "@/components/ui";
import { formatShortDate } from "@/lib/time";
import type { ImportSummary } from "@/server/services/import";

const MAX_BYTES = 5 * 1024 * 1024;
const REASON: Record<string, string> = {
  no_officer: "No active officer in this branch",
  all_full: "Every officer here is at their maximum list size",
};
const EXPECTED = "loan_id, borrower_name, contact_name, phone, address, pincode, branch, outstanding, emi, dpd";

export function ImportWizard({ today, latest, scopeLabel }: { today: string; latest: string | null; scopeLabel: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string; size: number } | null>(null);
  const [asOf, setAsOf] = useState(today);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [confirmCure, setConfirmCure] = useState(false);

  function pick(f: File | undefined) {
    setError(null);
    setPreview(null);
    setDone(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setError("Choose a .csv file. In Excel use File, Save as, CSV UTF-8.");
    if (f.size > MAX_BYTES) return setError("The file is larger than 5 MB. Export only overdue loans.");
    const reader = new FileReader();
    reader.onload = () => setFile({ name: f.name, text: String(reader.result ?? ""), size: f.size });
    reader.onerror = () => setError("Could not read the file. Try saving it again.");
    reader.readAsText(f);
  }

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/manage/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, fileName: file.name, asOfDate: asOf, csvText: file.text, confirmLargeCure: confirmCure }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "The server could not process this file.");
        return;
      }
      if (mode === "preview") setPreview(body);
      else if (body.importId) {
        setDone(body);
        setPreview(null);
        setFile(null);
        router.refresh();
      } else setPreview(body);
    } catch {
      setError("No connection to the server. Check the internet and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-control)] border border-ok/30 bg-surface p-6">
        <p className="flex items-center gap-2 text-lg font-semibold text-ok">
          <CircleCheck className="size-5" /> Imported the {formatShortDate(done.asOfDate)} file
        </p>
        <p className="mt-1 text-ink-2">
          {done.accepted} loans are on officer lists now: {done.newLoans} new, {done.curedLoans} paid up and removed
          {done.errors.length > 0 ? `, ${done.errors.length} rows skipped` : ""}. Officers see the new order the next time their phone syncs.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/manage/lists" className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 font-semibold text-white hover:bg-accent-strong">
            Open officer lists
          </Link>
          <Button variant="secondary" onClick={() => setDone(null)}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cx(
            "flex min-h-44 flex-col items-center justify-center rounded-[var(--radius-control)] border-2 border-dashed px-6 py-8 text-center",
            drag ? "border-accent bg-accent-soft" : "border-rule-strong bg-surface",
          )}
        >
          {file ? (
            <>
              <FileSpreadsheet className="size-8 text-accent" />
              <p className="mt-2 font-semibold">{file.name}</p>
              <p className="text-sm text-ink-2">
                {(file.size / 1024).toFixed(0)} KB, {file.text.split("\n").filter((l) => l.trim()).length - 1} rows
              </p>
              <button onClick={() => input.current?.click()} className="mt-2 h-9 text-sm font-semibold text-accent">
                Choose a different file
              </button>
            </>
          ) : (
            <>
              <Upload className="size-8 text-ink-3" />
              <p className="mt-2 font-semibold">Drop the overdue CSV here</p>
              <p className="text-sm text-ink-2">or</p>
              <Button variant="secondary" className="mt-2" onClick={() => input.current?.click()}>
                Choose file
              </Button>
            </>
          )}
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label="Overdue CSV file" />
        </div>
        <div className="space-y-4 rounded-[var(--radius-control)] border border-rule bg-surface p-4">
          <label className="block">
            <span className="text-sm font-semibold">File date</span>
            <input
              type="date"
              value={asOf}
              min={latest ?? undefined}
              max={today}
              onChange={(e) => {
                setAsOf(e.target.value);
                setPreview(null);
              }}
              className="mt-1 h-11 w-full rounded-[var(--radius-control)] border border-rule-strong px-3"
            />
            <span className="mt-1 block text-2xs text-ink-2">
              {latest ? `Last imported: ${formatShortDate(latest)}. Re-importing a date replaces it.` : "No file imported yet."}
            </span>
          </label>
          <a href="/api/manage/import/sample" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            <Download className="size-4" /> Download a sample file
          </a>
          <p className="text-2xs text-ink-2">The sample is today&rsquo;s book with 5 loans paid up, 4 new and 3 rows with mistakes, so you can see every check.</p>
        </div>
      </div>

      {error && <Banner tone="late" icon={<TriangleAlert className="size-4" />}>{error}</Banner>}

      {!preview && (
        <Button size="lg" disabled={!file} busy={busy === "preview"} onClick={() => send("preview")}>
          Check file
        </Button>
      )}

      {preview && <Preview p={preview} scopeLabel={scopeLabel} confirmCure={confirmCure} setConfirmCure={setConfirmCure} busy={busy} onCommit={() => send("commit")} onCancel={() => setPreview(null)} />}
    </div>
  );
}

function Preview({
  p,
  scopeLabel,
  confirmCure,
  setConfirmCure,
  busy,
  onCommit,
  onCancel,
}: {
  p: ImportSummary;
  scopeLabel: string;
  confirmCure: boolean;
  setConfirmCure: (v: boolean) => void;
  busy: "preview" | "commit" | null;
  onCommit: () => void;
  onCancel: () => void;
}) {
  if (p.missingColumns.length > 0) {
    return (
      <Banner tone="late" icon={<TriangleAlert className="size-4" />}>
        <p className="font-semibold">This file is missing columns: {p.missingColumns.join(", ")}.</p>
        <p className="mt-1">The first row must have these headers: {EXPECTED}. Optional: last_payment_date, paid_on_time_last_6, business_type, language.</p>
      </Banner>
    );
  }
  const maxBar = Math.max(...p.officers.map((o) => Math.max(o.total, o.maxLoad)), 1);
  return (
    <div className="space-y-6">
      <section className="grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Rows in file", p.totalRows],
          ["Will import", p.accepted],
          ["Rejected", p.errors.length],
          ["New overdue", p.newLoans],
          ["Paid up, will close", p.curedLoans],
          ["Promises settled", p.promisesKept + p.promisesBroken],
        ].map(([label, v]) => (
          <div key={label} className="bg-surface px-4 py-3">
            <p className="text-sm text-ink-2">{label}</p>
            <p className={cx("figure text-[2rem] leading-tight font-semibold", label === "Rejected" && Number(v) > 0 && "text-late")}>{v}</p>
          </div>
        ))}
      </section>

      {p.needsConfirmation && (
        <Banner tone="late" icon={<TriangleAlert className="size-4" />}>
          <p className="font-semibold">
            This file has {p.needsConfirmation.inFile} loans, but {p.needsConfirmation.currentlyOverdue} are overdue right now. Importing it would mark {p.curedLoans} loans as paid up.
          </p>
          <p className="mt-1">Check that the export from the loan system was not filtered or cut off.</p>
          <label className="mt-2 flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={confirmCure} onChange={(e) => setConfirmCure(e.target.checked)} className="size-5" />
            I checked: this is the complete overdue list
          </label>
        </Banner>
      )}

      {p.errors.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">
            {p.errors.length} {p.errors.length === 1 ? "row" : "rows"} will be skipped
          </h3>
          <div className="max-h-72 overflow-auto rounded-[var(--radius-control)] border border-late/30 bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface text-ink-2">
                <tr className="border-b border-rule">
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-3 py-2 font-medium">Loan ID</th>
                  <th className="px-3 py-2 font-medium">What to fix</th>
                </tr>
              </thead>
              <tbody>
                {p.errors.map((e) => (
                  <tr key={`${e.line}-${e.loanId}`} className="border-b border-rule align-top last:border-0">
                    <td className="figure px-3 py-2 text-base">{e.line}</td>
                    <td className="px-3 py-2">{e.loanId ?? "–"}</td>
                    <td className="px-3 py-2">
                      <ul className="list-disc pl-4">
                        {e.messages.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h3 className="font-semibold">Assignment plan for {scopeLabel}</h3>
        <p className="mb-3 text-sm text-ink-2">
          Borrowers stay with their current officer when possible; new ones go to the officer covering the pincode with the lightest list. {p.reassigned > 0 && `${p.reassigned} will move to a different officer.`}
        </p>
        <ul className="space-y-2 rounded-[var(--radius-control)] border border-rule bg-surface p-4">
          {p.officers.map((o) => (
            <li key={o.id} className="grid grid-cols-[150px_1fr_84px] items-center gap-3 text-sm sm:grid-cols-[200px_1fr_110px]">
              <span className="truncate font-medium">
                {o.name} <span className="text-ink-3">{o.branchId}</span>
              </span>
              <span className="relative h-3 rounded-sm bg-paper" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-sm bg-accent/80" style={{ width: `${(o.total / maxBar) * 100}%` }} />
                <span className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${(o.maxLoad / maxBar) * 100}%` }} title={`Max ${o.maxLoad}`} />
              </span>
              <span className="figure text-right text-base">
                {o.total}
                <span className="text-ink-3">/{o.maxLoad}</span> {o.added > 0 && <span className="text-sm text-accent">+{o.added}</span>}
              </span>
            </li>
          ))}
        </ul>
        {p.unassigned.length > 0 && (
          <div className="mt-3">
            <Banner tone="due" icon={<TriangleAlert className="size-4" />}>
              <p className="font-semibold">{p.unassigned.length} loans will wait for you to assign them.</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {p.unassigned.slice(0, 12).map((u) => (
                  <Chip key={u.loanId}>{u.loanId}</Chip>
                ))}
              </p>
              <p className="mt-1 text-sm">{[...new Set(p.unassigned.map((u) => REASON[u.reason] ?? u.reason))].join(". ")}.</p>
            </Banner>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" busy={busy === "commit"} disabled={p.accepted === 0 || (!!p.needsConfirmation && !confirmCure)} onClick={onCommit}>
          Import {p.accepted} loans
        </Button>
        <Button size="lg" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getBranches, getImports, latestFileDate } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { ImportWizard } from "@/components/manage/ImportWizard";
import { formatISTTime, formatShortDate, istDate } from "@/lib/time";

export const metadata: Metadata = { title: "Daily import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const at = await now();
  const [fileDate, imports, branches] = await Promise.all([latestFileDate(scope), getImports(scope), getBranches()]);
  const scopeName = scope ? (branches.find((b) => b.id === scope)?.name ?? scope) : "all branches";

  return (
    <>
      <PageHeader
        title="Daily import"
        description={`Upload the morning overdue export from the loan system. Kist checks every row, scores each loan and assigns it by pincode and workload, for ${scopeName}.`}
      />
      <ImportWizard today={istDate(at)} latest={fileDate} scopeLabel={scopeName} />

      <section className="mt-10">
        <h2 className="mb-2 text-lg font-semibold">Recent imports</h2>
        {imports.length === 0 ? (
          <p className="text-ink-2">No files imported yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-rule bg-surface">
            <table className="w-full min-w-[720px] text-left text-[0.95rem]">
              <thead className="text-sm text-ink-2">
                <tr className="border-b border-rule">
                  <th className="px-4 py-2.5 font-medium">File date</th>
                  <th className="px-4 py-2.5 font-medium">File</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rows</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rejected</th>
                  <th className="px-4 py-2.5 text-right font-medium">New</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid up</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {imports.map(({ i, by }) => (
                  <tr key={i.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 font-semibold">{formatShortDate(i.asOfDate)}</td>
                    <td className="px-4 py-3 text-ink-2">{i.fileName}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{i.accepted}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{i.rejected || "–"}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{i.newLoans}</td>
                    <td className="figure px-4 py-3 text-right text-lg">{i.curedLoans}</td>
                    <td className="px-4 py-3 text-sm text-ink-2">
                      {by ?? "System"}, {formatShortDate(istDate(i.createdAt))} {formatISTTime(i.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

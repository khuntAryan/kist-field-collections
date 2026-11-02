import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { getBranches, unassignedCount } from "@/server/queries/manage";
import { ManageShell } from "@/components/manage/Shell";

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const [branches, unassigned] = await Promise.all([getBranches(), unassignedCount(scope)]);
  const own = branches.find((b) => b.id === user.branchId);
  return (
    <ManageShell
      user={{ name: user.name, role: user.role as "manager" | "head", branchName: own?.name ?? "" }}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      scope={scope}
      unassigned={unassigned}
    >
      {children}
    </ManageShell>
  );
}

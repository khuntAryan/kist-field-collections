import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { now } from "@/server/clock";
import { getLists } from "@/server/queries/manage";
import { PageHeader } from "@/components/manage/Shell";
import { ListsBoard } from "@/components/manage/ListsBoard";
import { formatShortDate } from "@/lib/time";

export const metadata: Metadata = { title: "Officer lists" };
export const dynamic = "force-dynamic";

export default async function ListsPage({ searchParams }: { searchParams: Promise<{ officer?: string }> }) {
  const user = await requirePageUser(["manager", "head"]);
  const scope = await currentScope(user);
  const { officer } = await searchParams;
  const data = await getLists(scope, await now());
  return (
    <>
      <PageHeader
        title="Officer lists"
        description={`Each officer's order for today, from the ${formatShortDate(data.fileDate)} file. The score is advice: move a borrower up or down and the officer's phone follows at the next sync.`}
      />
      <ListsBoard officers={data.officers} unassigned={data.unassigned} selectedId={officer ?? null} />
    </>
  );
}

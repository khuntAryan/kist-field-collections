import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requirePageUser } from "@/server/auth/session";
import { OfficerApp } from "@/components/officer/OfficerApp";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function OfficerPage() {
  const user = await requirePageUser(["officer"]);
  const [branch] = user.branchId ? await db.select().from(schema.branches).where(eq(schema.branches.id, user.branchId)) : [];
  return <OfficerApp officer={{ id: user.id, name: user.name, language: user.language, branchName: branch?.name ?? "" }} />;
}

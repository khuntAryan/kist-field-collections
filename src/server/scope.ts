import "server-only";
import { cookies } from "next/headers";
import { branchScope, type SessionUser } from "./auth/session";

export const BRANCH_COOKIE = "kist_branch";

/** Which branch's data a manager page shows. Managers: always their own. Head: their pick, or all. */
export async function currentScope(user: SessionUser): Promise<string | null> {
  const picked = user.role === "head" ? (await cookies()).get(BRANCH_COOKIE)?.value : null;
  return branchScope(user, picked);
}

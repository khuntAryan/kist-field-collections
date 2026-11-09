import { describe, expect, it } from "vitest";
import { dbProblem } from "@/server/db/errors";

describe("database problem detection", () => {
  it("spots an exhausted connection pool, from Postgres or a pooler", () => {
    expect(dbProblem({ code: "53300", message: "sorry, too many clients already" })).toBe("busy");
    expect(dbProblem({ code: "XX000", message: "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15" })).toBe("busy");
    expect(dbProblem(new Error("timeout exceeded when trying to connect"))).toBe("busy");
    expect(dbProblem({ message: "Failed query", cause: { code: "53300", message: "too many connections" } })).toBe("busy");
  });

  it("keeps the other problems apart", () => {
    expect(dbProblem({ code: "42P01", message: 'relation "users" does not exist' })).toBe("not_migrated");
    expect(dbProblem({ code: "28P01", message: "password authentication failed" })).toBe("wrong_password");
    expect(dbProblem({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" })).toBe("unreachable");
    expect(dbProblem({ code: "23505", message: "duplicate key value" })).toBeNull();
  });
});

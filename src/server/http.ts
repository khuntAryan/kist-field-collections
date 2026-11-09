import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth/session";
import { dbProblem, DB_PROBLEM_MESSAGE } from "./db/errors";

/** Wraps an API handler so errors become clear JSON responses instead of stack traces. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "invalid_input", message: "Some fields are not valid.", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      console.error(err);
      const problem = dbProblem(err);
      if (problem) return NextResponse.json({ error: `database_${problem}`, message: DB_PROBLEM_MESSAGE[problem] }, { status: 503 });
      return NextResponse.json({ error: "server_error", message: "Something went wrong on the server. Try again." }, { status: 500 });
    }
  };
}

export async function readJson(request: Request, maxBytes = 1_000_000): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "Request body is not valid JSON.");
  }
}

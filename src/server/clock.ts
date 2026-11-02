import "server-only";
import { cookies } from "next/headers";
import { istDate, istDateTime } from "@/lib/time";

/**
 * Server "now". In demo mode a reviewer can pin the time of day (for example 8:30 pm)
 * to see the contact block, without waiting for the evening. The phone app picks this up
 * through the server-time offset it already uses to correct its own clock.
 */
export const DEMO_CLOCK_COOKIE = "kist_demo_clock";

export function demoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function parseDemoClock(value: string | undefined): { hours: number; minutes: number } | null {
  if (!value) return null;
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? { hours: Number(m[1]), minutes: Number(m[2]) } : null;
}

export async function now(): Promise<Date> {
  const real = new Date();
  if (!demoMode()) return real;
  const pinned = parseDemoClock((await cookies()).get(DEMO_CLOCK_COOKIE)?.value);
  if (!pinned) return real;
  // Keep seconds ticking so times stay distinct.
  const base = istDateTime(istDate(real), pinned.hours, pinned.minutes);
  return new Date(base.getTime() + (real.getTime() % 60_000));
}

export async function demoClockValue(): Promise<string | null> {
  if (!demoMode()) return null;
  const v = (await cookies()).get(DEMO_CLOCK_COOKIE)?.value;
  return parseDemoClock(v) ? v! : null;
}

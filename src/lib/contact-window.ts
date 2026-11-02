import { istDate, istDateTime, istParts, addDays } from "./time";

/**
 * RBI's fair-practice rules on recovery limit borrower contact to 8:00 am - 7:00 pm.
 * Kist applies the window to calls, visits and reminder messages, in India time.
 * 7:00 pm itself is outside the window.
 */
export const CONTACT_START_MIN = 8 * 60;
export const CONTACT_END_MIN = 19 * 60;

export type ContactCheck =
  | { allowed: true }
  | { allowed: false; reason: "before_window" | "after_window"; opensAt: Date };

export function checkContactTime(at: Date): ContactCheck {
  const m = istParts(at).minuteOfDay;
  if (m >= CONTACT_START_MIN && m < CONTACT_END_MIN) return { allowed: true };
  const today = istDate(at);
  if (m < CONTACT_START_MIN) {
    return { allowed: false, reason: "before_window", opensAt: istDateTime(today, 8) };
  }
  return { allowed: false, reason: "after_window", opensAt: istDateTime(addDays(today, 1), 8) };
}

export type WindowStatus =
  | { open: true; closesAt: Date; minutesLeft: number }
  | { open: false; opensAt: Date; reason: "before_window" | "after_window" };

export function contactWindowStatus(now: Date): WindowStatus {
  const check = checkContactTime(now);
  if (check.allowed) {
    const closesAt = istDateTime(istDate(now), 19);
    return { open: true, closesAt, minutesLeft: Math.ceil((closesAt.getTime() - now.getTime()) / 60_000) };
  }
  return { open: false, opensAt: check.opensAt, reason: check.reason };
}

/**
 * Phone clocks can be wrong or changed. Each event records the phone time plus the
 * offset to server time measured at the last successful sync. The server re-checks
 * the window on this corrected time.
 */
export function correctedTime(deviceTime: Date, serverOffsetMs: number): Date {
  return new Date(deviceTime.getTime() + serverOffsetMs);
}

/** Skew above this is flagged for the manager. */
export const CLOCK_SKEW_FLAG_MS = 5 * 60_000;

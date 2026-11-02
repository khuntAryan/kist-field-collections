import { describe, expect, it } from "vitest";
import { checkContactTime, contactWindowStatus, correctedTime } from "@/lib/contact-window";
import { istDateTime, istDate, addDays, daysBetween, weekStart, isISODate } from "@/lib/time";

describe("India time helpers", () => {
  it("builds IST moments regardless of server time zone", () => {
    expect(istDateTime("2026-11-02", 8).toISOString()).toBe("2026-11-02T02:30:00.000Z");
    expect(istDate(new Date("2026-11-02T19:00:00Z"))).toBe("2026-11-03"); // 00:30 IST next day
  });
  it("does date arithmetic across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday -> Monday
    expect(isISODate("2026-02-30")).toBe(false);
  });
});

describe("8 am to 7 pm contact window", () => {
  it("blocks 7:59 am and allows 8:00 am", () => {
    expect(checkContactTime(istDateTime("2026-11-02", 7, 59)).allowed).toBe(false);
    expect(checkContactTime(istDateTime("2026-11-02", 8, 0)).allowed).toBe(true);
  });
  it("allows 6:59 pm and blocks 7:00 pm", () => {
    expect(checkContactTime(istDateTime("2026-11-02", 18, 59)).allowed).toBe(true);
    const at7 = checkContactTime(istDateTime("2026-11-02", 19, 0));
    expect(at7.allowed).toBe(false);
    if (!at7.allowed) {
      expect(at7.reason).toBe("after_window");
      expect(at7.opensAt.toISOString()).toBe(istDateTime("2026-11-03", 8).toISOString());
    }
  });
  it("uses India time even when the moment is given in UTC", () => {
    // 01:00 UTC is 06:30 IST: blocked. 03:00 UTC is 08:30 IST: allowed.
    expect(checkContactTime(new Date("2026-11-02T01:00:00Z")).allowed).toBe(false);
    expect(checkContactTime(new Date("2026-11-02T03:00:00Z")).allowed).toBe(true);
  });
  it("reports minutes left until the window closes", () => {
    const s = contactWindowStatus(istDateTime("2026-11-02", 18, 30));
    expect(s.open).toBe(true);
    if (s.open) expect(s.minutesLeft).toBe(30);
  });
  it("re-checks an offline event on corrected time when the phone clock is wrong", () => {
    // Phone says 6:45 pm but is 30 minutes slow: the real time was 7:15 pm.
    const phone = istDateTime("2026-11-02", 18, 45);
    const real = correctedTime(phone, 30 * 60_000);
    expect(checkContactTime(phone).allowed).toBe(true);
    expect(checkContactTime(real).allowed).toBe(false);
  });
});

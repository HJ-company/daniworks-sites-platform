import { describe, expect, it } from "vitest";
import { addDays, addMonths, canPublish, coverage, nextUnpaidPeriod, daysBetween, defaultPeriod, deriveStatus, GRACE_DAYS, isDay } from "../src/billing.js";

describe("dates", () => {
  it("adds days and months, clamping to the end of a short month", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-20", 12)).toBe("2027-11-20");
    expect(daysBetween("2026-11-01", "2026-11-15")).toBe(14);
  });

  it("accepts only real calendar days", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-2-1")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-00-10")).toBe(false);
    expect(isDay(20261120)).toBe(false);
  });
});

describe("defaultPeriod", () => {
  it("first payment covers a month or a year from the payment day", () => {
    expect(defaultPeriod("monthly", null, "2026-11-20")).toEqual({ start: "2026-11-20", end: "2026-12-19" });
    expect(defaultPeriod("yearly", null, "2026-11-20")).toEqual({ start: "2026-11-20", end: "2027-11-19" });
  });

  it("renewal continues right after the paid period, even if paid early or late", () => {
    expect(defaultPeriod("monthly", "2026-12-19", "2026-12-10")).toEqual({ start: "2026-12-20", end: "2027-01-19" });
    // Paid five days late, within the grace period: no free days.
    expect(defaultPeriod("monthly", "2026-12-19", "2026-12-24").start).toBe("2026-12-20");
    // Paid after the site was suspended: a fresh period from the payment day.
    expect(defaultPeriod("monthly", "2026-12-19", "2027-02-01")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });
});

describe("coverage", () => {
  const p = (start: string, end: string) => ({ start, end });

  it("joins overlapping and back-to-back periods into one paid run", () => {
    const periods = [p("2026-11-01", "2026-11-30"), p("2026-12-01", "2026-12-31"), p("2026-12-15", "2027-01-10")];
    expect(coverage(periods, "2026-11-15").coveredThrough).toBe("2027-01-10");
  });

  it("a gap between periods is not paid", () => {
    const periods = [p("2026-11-01", "2026-11-30"), p("2026-12-10", "2027-01-09")];
    expect(coverage(periods, "2026-11-15").coveredThrough).toBe("2026-11-30");
    expect(coverage(periods, "2026-12-05")).toEqual({ coveredThrough: null, lastEndBefore: "2026-11-30", latestEnd: "2027-01-09" });
  });

  it("a period that starts later does not cover today", () => {
    expect(coverage([p("2026-12-01", "2026-12-31")], "2026-11-20").coveredThrough).toBeNull();
  });
});

describe("nextUnpaidPeriod", () => {
  it("fills today's gap up to a later prepaid period instead of skipping past it", () => {
    expect(nextUnpaidPeriod("monthly", null, [{ start: "2026-12-01", end: "2026-12-31" }], "2026-11-20")).toEqual({
      start: "2026-11-20",
      end: "2026-11-30",
    });
  });

  it("continues the current paid run", () => {
    const periods = [{ start: "2026-11-01", end: "2026-11-30" }];
    expect(nextUnpaidPeriod("monthly", "2026-11-30", periods, "2026-11-20")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("deriveStatus", () => {
  const state = (periods: { start: string; end: string }[], billedAt: string | null = null) => ({ cancelled: false, billedAt, periods });
  const month = (end: string) => [{ start: addDays(end, -29), end }];

  it("before any payment: trial until billed, then awaiting", () => {
    expect(deriveStatus(state([]), "2026-11-20")).toBe("trial");
    expect(deriveStatus(state([], "2026-11-20T00:00:00Z"), "2026-11-20")).toBe("awaiting");
  });

  it("only a future period: awaiting, not active", () => {
    expect(deriveStatus(state([{ start: "2026-12-01", end: "2026-12-31" }]), "2026-11-20")).toBe("awaiting");
  });

  it("active through the last paid day, overdue for the grace period, then suspended", () => {
    expect(deriveStatus(state(month("2026-11-30")), "2026-11-30")).toBe("active");
    expect(deriveStatus(state(month("2026-11-30")), "2026-12-01")).toBe("overdue");
    expect(deriveStatus(state(month("2026-11-30")), addDays("2026-11-30", GRACE_DAYS))).toBe("overdue");
    expect(deriveStatus(state(month("2026-11-30")), addDays("2026-11-30", GRACE_DAYS + 1))).toBe("suspended");
  });

  it("in a gap before the next prepaid period: overdue, counted from the last end", () => {
    const periods = [...month("2026-11-30"), { start: "2026-12-10", end: "2027-01-09" }];
    expect(deriveStatus(state(periods), "2026-12-05")).toBe("overdue");
    expect(deriveStatus(state(periods), "2026-12-10")).toBe("active");
  });

  it("cancellation wins", () => {
    expect(deriveStatus({ cancelled: true, billedAt: null, periods: month("2099-01-01") }, "2026-11-20")).toBe("cancelled");
  });

  it("publishing is allowed only while paid or in grace", () => {
    expect(["trial", "awaiting", "active", "overdue", "suspended", "cancelled"].filter((s) => canPublish(s as never))).toEqual([
      "active",
      "overdue",
    ]);
  });
});

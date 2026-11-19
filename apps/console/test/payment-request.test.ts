import { describe, expect, it } from "vitest";
import type { Subscription } from "../src/api.js";
import { paymentRequest } from "../src/pages/billing/billing-ui.js";

const sub = (over: Partial<Subscription>): Subscription => ({
  siteId: "s1",
  cycle: "monthly",
  amount: 30000,
  status: "awaiting",
  statusLabel: "",
  billedAt: "2026-11-01T00:00:00Z",
  paidThrough: null,
  latestEnd: null,
  nextPaidStart: null,
  nextDueOn: null,
  graceEndsOn: null,
  graceDaysLeft: null,
  daysOverdue: null,
  canPublish: false,
  nextPeriod: { start: "2026-11-20", end: "2026-12-19" },
  ...over,
});

describe("paymentRequest", () => {
  it("billed: amount, period, account, publish on payment", () => {
    const text = paymentRequest("반짝 이사청소", sub({}), "국민 000-00-0000")!;
    expect(text).toContain("금액: 30,000원(부가세 별도)");
    expect(text).toContain("이용 기간: 2026-11-20 ~ 2026-12-19");
    expect(text).toContain("입금 계좌: 국민 000-00-0000");
    expect(text).toContain("입금이 확인되면 홈페이지를 공개합니다.");
  });

  it("no account configured: the line is left out", () => {
    expect(paymentRequest("가게", sub({}), null)).not.toContain("입금 계좌");
  });

  it("nothing to ask: paid up, trial, or billed but already prepaid for a later period", () => {
    expect(paymentRequest("가게", sub({ status: "active" }), null)).toBeNull();
    expect(paymentRequest("가게", sub({ status: "trial" }), null)).toBeNull();
    expect(paymentRequest("가게", sub({ status: "awaiting", nextPaidStart: "2026-12-01" }), null)).toBeNull();
  });

  it("overdue with a later prepaid period still asks for the gap", () => {
    const text = paymentRequest("가게", sub({ status: "overdue", daysOverdue: 3, graceEndsOn: "2026-12-11", nextPaidStart: "2026-12-10" }), null);
    expect(text).toContain("3일 지났습니다");
  });

  it("billing suspension reopens on payment; an operator's suspension does not", () => {
    expect(paymentRequest("가게", sub({ status: "suspended" }), null)).toContain("바로 다시 공개됩니다");
    expect(paymentRequest("가게", sub({ status: "suspended" }), null, true)).toContain("담당자가 확인 후");
    // An operator's suspension of a paid-up site is no reason to ask for money.
    expect(paymentRequest("가게", sub({ status: "active" }), null, true)).toBeNull();
  });
});

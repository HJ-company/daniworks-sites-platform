import { Chip } from "@mui/material";
import { won, type BillingStatus, type Subscription } from "../../api.js";

const COLORS: Record<BillingStatus, "default" | "info" | "success" | "warning" | "error"> = {
  trial: "default",
  awaiting: "info",
  active: "success",
  overdue: "warning",
  suspended: "error",
  cancelled: "default",
};
const LABELS: Record<BillingStatus, string> = {
  trial: "시안",
  awaiting: "입금 대기",
  active: "활성",
  overdue: "연체",
  suspended: "중단",
  cancelled: "해지",
};

export function BillingChip({ status }: { status: BillingStatus | null }) {
  if (!status) return <Chip size="small" label="-" variant="outlined" />;
  return <Chip size="small" label={LABELS[status]} color={COLORS[status]} variant={status === "trial" ? "outlined" : "filled"} />;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
/** `2026-11-29` → `11월 29일(일)`: how dates are said to customers. */
export function dayLabel(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일(${WEEKDAYS[date.getUTCDay()]})`;
}
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** One line on where the subscription stands, for lists and cards. */
export function billingSummary(sub: Subscription): string {
  switch (sub.status) {
    case "trial":
      return "시안 단계입니다. 사장님이 확정하면 청구하세요.";
    case "awaiting":
      return sub.nextPaidStart ? `입금된 이용 기간이 ${dayLabel(sub.nextPaidStart)}부터 시작합니다. 그 전에는 공개되지 않습니다.` : "입금을 기다리고 있습니다.";
    case "active":
      return `${dayLabel(sub.paidThrough!)}까지 납부됨 · 다음 결제일 ${dayLabel(sub.nextDueOn!)}`;
    case "overdue":
      return `${sub.daysOverdue}일 연체 · ${dayLabel(sub.graceEndsOn!)}까지 공개, ${dayLabel(nextDay(sub.graceEndsOn!))}부터 공개 중단`;
    case "suspended":
      return `${sub.daysOverdue}일 연체로 공개 중단 · 입금을 확인하면 바로 다시 공개됩니다.`;
    case "cancelled":
      return "해지된 사이트입니다.";
  }
}

/**
 * The message an operator sends an owner who has to pay (billed, overdue or taken down): amount,
 * period, account and what happens next. Null when there is nothing to ask for. `manualStop`: an operator took the
 * site down, so paying does not bring it back on its own.
 */
export function paymentRequest(name: string, sub: Subscription, account: string | null, manualStop = false): string | null {
  // Billed but already paid for a period that has not started: nothing more to ask. (Overdue or
  // suspended with a later prepaid period still owes the gap before it.)
  if (sub.status === "awaiting" && sub.nextPaidStart) return null;
  const next: Partial<Record<BillingStatus, string>> = {
    awaiting: "입금이 확인되면 홈페이지를 공개합니다.",
    overdue: `${sub.daysOverdue}일 지났습니다. ${sub.graceEndsOn ? dayLabel(sub.graceEndsOn) : "곧"}까지 입금되지 않으면 홈페이지가 '준비 중' 화면으로 바뀝니다.`,
    suspended: "미납으로 지금 홈페이지에 '준비 중' 화면이 보입니다. 입금이 확인되면 바로 다시 공개됩니다.",
  };
  let after = next[sub.status];
  if (!after) return null; // paid up (or trial, cancelled): nothing to ask for
  if (manualStop && sub.status !== "awaiting") after = "입금이 확인되면 담당자가 확인 후 홈페이지를 다시 공개합니다.";
  return [
    "[홈페이지 이용료 입금 안내]",
    `사장님, ${name} 홈페이지 이용료 안내드립니다.`,
    "",
    `금액: ${won(sub.amount)}(부가세 별도)`,
    `이용 기간: ${sub.nextPeriod.start} ~ ${sub.nextPeriod.end}`,
    ...(account ? [`입금 계좌: ${account}`] : []),
    "",
    after,
    "입금자명을 상호로 해 주시면 확인이 빠릅니다.",
  ].join("\n");
}

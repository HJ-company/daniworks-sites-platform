import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, won, type BillingStatus, type Payment, type Subscription } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";

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

/** One line on where the subscription stands, for lists and cards. */
export function billingSummary(sub: Subscription): string {
  switch (sub.status) {
    case "trial":
      return "시안 단계입니다. 사장님이 확정하면 청구하세요.";
    case "awaiting":
      return sub.nextPaidStart ? `입금된 이용 기간이 ${sub.nextPaidStart}부터 시작합니다. 그 전에는 공개되지 않습니다.` : "입금을 기다리고 있습니다.";
    case "active":
      return `${sub.paidThrough}까지 납부됨 · 다음 결제일 ${sub.nextDueOn}`;
    case "overdue":
      return `${sub.daysOverdue}일 연체 · ${sub.graceDaysLeft}일 뒤(${sub.graceEndsOn} 다음 날) 공개가 중단됩니다.`;
    case "suspended":
      return `${sub.daysOverdue}일 연체로 공개가 중단되었습니다. 입금을 확인하면 바로 다시 공개됩니다.`;
    case "cancelled":
      return "해지된 사이트입니다.";
  }
}

const digits = (value: string) => value.replace(/[^\d]/g, "");

/**
 * Confirm a deposit. Amount and period come prefilled from the subscription (next unpaid
 * period); the operator can change them, e.g. a customer who paid two months at once.
 */
export function PaymentDialog({
  open,
  onClose,
  siteId,
  title,
  subscription,
}: {
  open: boolean;
  onClose: () => void;
  siteId: string;
  title: string;
  subscription: Subscription;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(String(subscription.amount));
  const [payerName, setPayerName] = useState("");
  const [initialDay] = useState(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));
  const [paidOn, setPaidOn] = useState(initialDay);
  const [start, setStart] = useState(subscription.nextPeriod.start);
  const [end, setEnd] = useState(subscription.nextPeriod.end);
  const [memo, setMemo] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<{ payment: Payment; site: "resumed" | "suspended" | null }>(`/sites/${siteId}/payments`, {
        method: "POST",
        // The period shown is the period recorded. Only when nothing date-related was touched is it
        // left to the server, which computes the same default and keeps two simultaneous
        // confirmations from landing on the same period.
        json: {
          amount: Number(digits(amount)),
          payerName,
          paidOn,
          memo,
          ...(start !== subscription.nextPeriod.start || end !== subscription.nextPeriod.end || paidOn !== initialDay
            ? { periodStart: start, periodEnd: end }
            : {}),
        },
      }),
    onSuccess: (data) => {
      toast(data.site === "resumed" ? "입금을 확인했습니다. 사이트를 다시 공개했습니다" : "입금을 확인했습니다");
      void queryClient.invalidateQueries();
      onClose();
    },
  });
  const short = Number(digits(amount)) < subscription.amount;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>입금 확인 · {title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="입금액"
            value={amount}
            onChange={(e) => setAmount(digits(e.target.value))}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">원</InputAdornment> },
              htmlInput: { inputMode: "numeric", name: "amount" },
            }}
            helperText={`청구 금액 ${won(subscription.amount)}${short ? " · 청구 금액보다 적습니다" : ""}`}
          />
          <TextField label="입금자명" value={payerName} onChange={(e) => setPayerName(e.target.value)} slotProps={{ htmlInput: { name: "payerName" } }} />
          <TextField label="입금일" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Stack direction="row" spacing={1}>
            <TextField
              label="이용 시작일"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { name: "periodStart" } }}
              fullWidth
            />
            <TextField
              label="이용 종료일"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { name: "periodEnd" } }}
              fullWidth
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            이 입금으로 공개가 유지되는 기간입니다. 기본값은 다음 미납 기간이고, 여러 달치를 한 번에 받았다면 종료일을 늘리세요.
          </Typography>
          <TextField label="메모" value={memo} onChange={(e) => setMemo(e.target.value)} multiline minRows={2} />
          {end < start ? <Alert severity="warning">종료일이 시작일보다 빠릅니다.</Alert> : null}
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !amount || end < start}>
          입금 확인
        </Button>
      </DialogActions>
    </Dialog>
  );
}

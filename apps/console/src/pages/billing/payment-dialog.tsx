import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, kst, kstToday, won, type Payment, type Subscription } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";
import { dayLabel } from "./billing-ui.js";

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
  const [initialDay] = useState(kstToday);
  const [paidOn, setPaidOn] = useState(initialDay);
  const [start, setStart] = useState(subscription.nextPeriod.start);
  const [end, setEnd] = useState(subscription.nextPeriod.end);
  const [memo, setMemo] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<{ payment: Payment; subscription: Subscription; site: "resumed" | "suspended" | null }>(`/sites/${siteId}/payments`, {
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
      // Say what the payment bought: the paid-through date, and a resumed site.
      const through = data.subscription.paidThrough ? ` · ${dayLabel(data.subscription.paidThrough)}까지 납부` : "";
      toast(`${title} 입금을 확인했습니다${through}${data.site === "resumed" ? " · 다시 공개했습니다" : ""}`);
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
            helperText={`청구 금액 ${won(subscription.amount)}(부가세 별도)${short ? " · 청구 금액보다 적습니다" : ""}`}
          />
          <TextField
            label="입금자명"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            helperText="통장에 찍힌 이름. 나중에 입금을 대조할 때 씁니다"
            slotProps={{ htmlInput: { name: "payerName" } }}
          />
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
          <Typography variant="caption" color="text.secondary" data-testid="period-rule">
            이 입금으로 공개가 유지되는 기간입니다.{" "}
            {subscription.status === "suspended"
              ? `공개가 중단된 사이트라 입금일부터 새 기간으로 잡았습니다(중단 기간은 청구하지 않음). 밀린 기간까지 받았다면 시작일을 ${subscription.nextDueOn ?? "지난 기간 다음 날"}로 바꾸세요.`
              : subscription.status === "overdue"
                ? "유예 중이라 지난 기간이 끝난 다음 날부터 이어서 잡았습니다."
                : "다음 미납 기간으로 잡았습니다."}{" "}
            여러 달치를 한 번에 받았다면 종료일을 늘리세요.
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

/** Corrections: the period a payment keeps the site public, payer, invoice date, amount, memo. */
export function EditPaymentDialog({ payment, onClose, focusInvoice = false }: { payment: Payment; onClose: () => void; focusInvoice?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [start, setStart] = useState(payment.period_start);
  const [end, setEnd] = useState(payment.period_end);
  const [payerName, setPayerName] = useState(payment.payer_name ?? "");
  const [invoice, setInvoice] = useState(payment.invoice_issued_on ?? "");
  const [amount, setAmount] = useState(String(payment.amount));
  const [memo, setMemo] = useState(payment.memo ?? "");
  // Send only what changed, so a concurrent edit of another field is not undone.
  const changes = Object.fromEntries(
    (
      [
        ["periodStart", start, payment.period_start],
        ["periodEnd", end, payment.period_end],
        ["payerName", payerName, payment.payer_name ?? ""],
        ["invoiceIssuedOn", invoice, payment.invoice_issued_on ?? ""],
        ["amount", amount, String(payment.amount)],
        ["memo", memo, payment.memo ?? ""],
      ] as const
    )
      .filter(([, value, before]) => value !== before)
      .map(([key, value]) => [key, key === "amount" ? Number(value) : value]),
  );
  const save = useMutation({
    mutationFn: () => api(`/payments/${payment.id}`, { method: "PATCH", json: changes }),
    onSuccess: () => {
      toast("결제 기록을 고쳤습니다");
      void queryClient.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>결제 수정 · {payment.business_name ?? payment.site_slug}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <DialogContentText variant="body2" data-testid="payment-confirmed-by">
            {payment.confirmed_by ?? "알 수 없음"}이(가) {kst(payment.created_at)}에 입금을 확인했습니다. 이용 기간을 바꾸면 공개 여부도 바로 다시
            계산됩니다(기간이 끝나고 14일이 지나면 공개 중단).
          </DialogContentText>
          <Stack direction="row" spacing={1}>
            <TextField label="이용 시작일" type="date" value={start} onChange={(e) => setStart(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { name: "periodStart" } }} fullWidth />
            <TextField label="이용 종료일" type="date" value={end} onChange={(e) => setEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { name: "periodEnd" } }} fullWidth />
          </Stack>
          <TextField label="입금자명" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
          <TextField
            label="입금액"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">원</InputAdornment> } }}
          />
          <TextField
            label="세금계산서 발행일"
            type="date"
            autoFocus={focusInvoice}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            helperText="홈택스에서 발행한 날. 비우면 미발행"
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { name: "invoiceIssuedOn" },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Button size="small" onClick={() => setInvoice(kstToday())}>
                      오늘
                    </Button>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField label="메모" value={memo} onChange={(e) => setMemo(e.target.value)} multiline minRows={2} />
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || end < start || !Object.keys(changes).length}>
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}

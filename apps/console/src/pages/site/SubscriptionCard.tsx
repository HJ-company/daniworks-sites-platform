import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { api, CYCLE_LABEL, won, type Cycle, type CustomerSummary, type Payment, type SiteRow, type Subscription } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";
import { BillingChip, billingSummary, PaymentDialog } from "../billing/billing-ui.js";

export function useSubscription(siteId: string) {
  return useQuery({
    queryKey: ["subscription", siteId],
    queryFn: () => api<{ subscription: Subscription; payments: Payment[] }>(`/sites/${siteId}/subscription`),
  });
}

/** Customer, subscription (cycle, amount), status and the actions that move it. */
export function SubscriptionCard({ siteId, site }: { siteId: string; site: SiteRow }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const data = useSubscription(siteId);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries();
  const bill = useMutation({
    mutationFn: () => api(`/sites/${siteId}/subscription/bill`, { method: "POST", json: {} }),
    onSuccess: () => {
      toast("청구했습니다. 입금되면 '입금 확인'을 누르세요");
      refresh();
    },
  });
  if (data.error) return <ErrorAlert error={data.error} />;
  if (!data.data) return null;
  const sub = data.data.subscription;
  const payments = data.data.payments.slice(0, 5);
  const title = site.business_name ?? site.slug;
  return (
    <Paper sx={{ p: 2 }} data-testid="subscription-card">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          구독
        </Typography>
        <BillingChip status={sub.status} />
        <Typography variant="body2" sx={{ flex: 1 }}>
          {CYCLE_LABEL[sub.cycle]} {won(sub.amount)}
          <Button size="small" onClick={() => setEditing(true)} disabled={sub.status === "cancelled"}>
            변경
          </Button>
        </Typography>
        {sub.status === "trial" ? (
          <Button onClick={() => bill.mutate()} disabled={bill.isPending}>
            청구하기
          </Button>
        ) : null}
        <Button variant="contained" onClick={() => setPaying(true)} disabled={sub.status === "cancelled"}>
          입금 확인
        </Button>
      </Stack>
      <Typography variant="body2" color={sub.status === "overdue" || sub.status === "suspended" ? "error" : "text.secondary"} data-testid="billing-summary">
        {billingSummary(sub)}
      </Typography>
      {site.status === "suspended" && !site.cancelled_at ? (
        <Alert severity={site.suspend_reason === "billing" ? "error" : "warning"} sx={{ mt: 1 }} data-testid="suspend-reason">
          {site.suspend_reason === "billing"
            ? "미납으로 공개가 중단되어 방문자에게 '준비 중' 안내가 보입니다. 입금을 확인하면 자동으로 다시 공개됩니다."
            : "운영자가 공개를 정지했습니다. 입금과 관계없이 '공개 재개'를 눌러야 다시 공개됩니다."}
        </Alert>
      ) : null}
      <CustomerLink siteId={siteId} site={site} />
      <ErrorAlert error={bill.error} />
      {payments.length ? (
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell>입금일</TableCell>
              <TableCell>금액</TableCell>
              <TableCell>이용 기간</TableCell>
              <TableCell>입금자</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id} sx={p.voided_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                <TableCell>{p.paid_on}</TableCell>
                <TableCell>{won(p.amount)}</TableCell>
                <TableCell>
                  {p.period_start} ~ {p.period_end}
                </TableCell>
                <TableCell>{p.payer_name ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <Link component={RouterLink} to="/payments?tab=history" variant="body2" sx={{ display: "inline-block", mt: 1 }}>
        결제 내역 전체·수정
      </Link>
      {paying ? <PaymentDialog open onClose={() => setPaying(false)} siteId={siteId} title={title} subscription={sub} /> : null}
      {editing ? <PlanDialog siteId={siteId} subscription={sub} onClose={() => setEditing(false)} /> : null}
    </Paper>
  );
}

function PlanDialog({ siteId, subscription, onClose }: { siteId: string; subscription: Subscription; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cycle, setCycle] = useState<Cycle>(subscription.cycle);
  const [amount, setAmount] = useState(String(subscription.amount));
  const save = useMutation({
    mutationFn: () => api(`/sites/${siteId}/subscription`, { method: "PATCH", json: { cycle, amount: Number(amount) } }),
    onSuccess: () => {
      toast("구독 조건을 바꿨습니다");
      void queryClient.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>구독 조건</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="결제 주기"
            value={cycle}
            onChange={(e) => {
              const next = e.target.value as Cycle;
              setCycle(next);
              // Default prices: 30,000원 a month, 360,000원 a year (supply price).
              setAmount(String(next === "yearly" ? 360_000 : 30_000));
            }}
          >
            <MenuItem value="monthly">월 단위</MenuItem>
            <MenuItem value="yearly">연 단위</MenuItem>
          </TextField>
          <TextField
            label="금액(공급가)"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            slotProps={{ input: { endAdornment: <InputAdornment position="end">원</InputAdornment> }, htmlInput: { inputMode: "numeric" } }}
            helperText="이미 받은 입금의 기간은 바뀌지 않습니다. 다음 입금부터 적용됩니다."
          />
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={!amount || save.isPending}>
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CustomerLink({ siteId, site }: { siteId: string; site: SiteRow }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ customers: CustomerSummary[] }>("/customers") });
  const link = useMutation({
    mutationFn: (customerId: string | null) => api(`/sites/${siteId}`, { method: "PATCH", json: { customerId } }),
    onSuccess: () => {
      toast("고객을 연결했습니다");
      void queryClient.invalidateQueries();
    },
  });
  const options = customers.data?.customers ?? [];
  const current = options.find((c) => c.id === site.customer_id) ?? null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1.5 }}>
      <Autocomplete
        size="small"
        sx={{ minWidth: 260 }}
        options={options}
        value={current}
        getOptionLabel={(c) => c.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, value) => link.mutate(value?.id ?? null)}
        renderInput={(params) => <TextField {...params} label="고객(사장님)" />}
        noOptionsText="고객이 없습니다. 고객 메뉴에서 추가하세요"
      />
      {current ? (
        <Link component={RouterLink} to={`/customers/${current.id}`} variant="body2">
          고객 정보
        </Link>
      ) : null}
      <ErrorAlert error={link.error} />
    </Stack>
  );
}

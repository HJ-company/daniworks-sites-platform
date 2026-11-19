import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { gridLocale } from "../../grid-locale.js";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { api, CYCLE_LABEL, won, type Payment, type QueueRow } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";
import { BillingChip, billingSummary, PaymentDialog } from "./billing-ui.js";

/** Auto-height rows: keep every cell's content vertically centred. */
const CENTERED = { "& .MuiDataGrid-cell": { display: "flex", alignItems: "center", py: 0.5 } };

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "queue";
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        결제
      </Typography>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={tab} onChange={(_, value: string) => setParams(value === "queue" ? {} : { tab: value })}>
          <Tab value="queue" label="확인 필요" data-testid="tab-queue" />
          <Tab value="history" label="결제 내역" data-testid="tab-history" />
        </Tabs>
      </Box>
      {tab === "queue" ? <Queue /> : <History />}
    </Stack>
  );
}

function Queue() {
  const queue = useQuery({ queryKey: ["billing-queue"], queryFn: () => api<{ today: string; sites: QueueRow[] }>("/billing/queue") });
  const [paying, setPaying] = useState<QueueRow | null>(null);
  const columns: GridColDef<QueueRow>[] = [
    {
      field: "business_name",
      headerName: "상호",
      flex: 1,
      minWidth: 160,
      valueGetter: (_v, row) => row.business_name ?? row.slug,
      renderCell: ({ row }) => (
        <Stack sx={{ lineHeight: 1.3 }}>
          <Link component={RouterLink} to={`/sites/${row.site_id}`}>
            {row.business_name ?? row.slug}
          </Link>
          <Typography variant="caption" color="text.secondary">
            {row.slug}
          </Typography>
        </Stack>
      ),
    },
    { field: "customer_name", headerName: "고객", width: 140, valueGetter: (v) => v ?? "-" },
    { field: "status", headerName: "상태", width: 100, renderCell: ({ row }) => <BillingChip status={row.status} /> },
    { field: "amount", headerName: "청구", width: 120, valueGetter: (_v, row) => `${CYCLE_LABEL[row.cycle]} ${won(row.amount)}` },
    {
      field: "summary",
      headerName: "상황",
      flex: 1.6,
      minWidth: 260,
      valueGetter: (_v, row) => billingSummary(row),
      renderCell: ({ value }) => <Typography variant="body2" sx={{ whiteSpace: "normal", py: 1 }}>{value as string}</Typography>,
    },
    {
      field: "action",
      headerName: "",
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Button size="small" variant="contained" onClick={() => setPaying(row)} data-testid={`pay-${row.slug}`}>
          입금 확인
        </Button>
      ),
    },
  ];
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        입금을 기다리거나 연체·중단된 사이트입니다. 급한 순서(중단 → 유예 적게 남은 연체 → 입금 대기)로 보입니다.
      </Typography>
      <ErrorAlert error={queue.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          rows={queue.data?.sites ?? []}
          getRowId={(row) => row.site_id}
          getRowHeight={() => "auto"}
          sx={CENTERED}
          columns={columns}
          loading={queue.isLoading}
          autoHeight
          disableRowSelectionOnClick
          localeText={{ ...gridLocale, noRowsLabel: "확인할 결제가 없습니다" }}
          hideFooter={(queue.data?.sites.length ?? 0) <= 25}
        />
      </Box>
      {paying ? (
        <PaymentDialog open onClose={() => setPaying(null)} siteId={paying.site_id} title={paying.business_name ?? paying.slug} subscription={paying} />
      ) : null}
    </Stack>
  );
}

const monthRange = (offset: number) => {
  const now = new Date(Date.now() + 9 * 3600_000);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return [first, last].map((d) => d.toISOString().slice(0, 10)) as [string, string];
};

type HistoryRow = Payment & { customer_name: string | null; site_exists: boolean };

function History() {
  // Filters live in the address, so coming back (or sharing the link) keeps them.
  const [params, setParams] = useSearchParams();
  // A cleared date stays cleared (`from=`): the api treats an empty bound as unbounded.
  const from = params.has("from") ? params.get("from")! : monthsAgo(3);
  const to = params.has("to") ? params.get("to")! : today();
  const method = params.get("method") ?? "";
  const search = params.get("q") ?? "";
  // Built from the live address, not the last render: quick successive changes (a date, then a
  // search) must not start from a stale copy and drop each other.
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value || key === "from" || key === "to") next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const setFrom = (value: string) => update({ from: value });
  const setTo = (value: string) => update({ to: value });
  const setMethod = (value: string) => update({ method: value });
  const setSearch = (value: string) => update({ q: value });
  const setRange = ([start, end]: [string, string]) => update({ from: start, to: end });
  const [editing, setEditing] = useState<Payment | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const query = new URLSearchParams({ from, to, ...(method ? { method } : {}) });
  const history = useQuery({
    queryKey: ["payments", from, to, method],
    queryFn: () =>
      api<{ payments: HistoryRow[]; count: number; total: number; voided: number; truncated: boolean }>(`/payments?${query.toString()}`),
  });
  const q = search.trim().toLowerCase();
  const rows = (history.data?.payments ?? []).filter(
    (p) => !q || [p.business_name, p.site_slug, p.customer_name, p.payer_name].some((v) => v?.toLowerCase().includes(q)),
  );
  const columns: GridColDef<HistoryRow>[] = [
    { field: "paid_on", headerName: "입금일", width: 110 },
    {
      field: "business_name",
      headerName: "상호",
      flex: 1,
      minWidth: 150,
      valueGetter: (_v, row) => row.business_name ?? row.site_slug,
      renderCell: ({ row }) =>
        row.site_exists ? (
          <Link component={RouterLink} to={`/sites/${row.site_id}`}>
            {row.business_name ?? row.site_slug}
          </Link>
        ) : (
          <Typography variant="body2" color="text.secondary" title="완전 삭제된 사이트입니다. 결제 기록만 남아 있습니다">
            {row.business_name ?? row.site_slug} (삭제됨)
          </Typography>
        ),
    },
    { field: "customer_name", headerName: "고객", width: 140, valueGetter: (v) => v ?? "-" },
    { field: "amount", headerName: "금액", width: 110, valueGetter: (v: number) => won(v) },
    { field: "payer_name", headerName: "입금자", width: 100, valueGetter: (v) => v ?? "-" },
    { field: "period", headerName: "이용 기간", width: 200, valueGetter: (_v, row) => `${row.period_start} ~ ${row.period_end}` },
    { field: "invoice_issued_on", headerName: "계산서", width: 110, valueGetter: (v) => v ?? "미발행" },
    {
      field: "state",
      headerName: "",
      width: 170,
      sortable: false,
      renderCell: ({ row }) =>
        row.voided_at ? (
          <Typography variant="caption" color="text.secondary" title={row.void_reason ?? ""}>
            취소됨 · {row.void_reason}
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", height: "100%" }}>
            <Button size="small" onClick={() => setEditing(row)} data-testid={`edit-${row.id}`}>
              수정
            </Button>
            <Button size="small" color="error" onClick={() => setVoiding(row)}>
              취소
            </Button>
          </Stack>
        ),
    },
  ];
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" onClick={() => setRange(monthRange(0))}>
          이번 달
        </Button>
        <Button size="small" variant="outlined" onClick={() => setRange(monthRange(-1))}>
          지난달
        </Button>
        <Button size="small" variant="outlined" onClick={() => setRange([monthsAgo(3), today()])}>
          최근 3개월
        </Button>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <TextField size="small" type="date" label="입금일 부터" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" type="date" label="까지" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField
          size="small"
          select
          label="수단"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          sx={{ minWidth: 120 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">전체</MenuItem>
          <MenuItem value="manual">계좌 입금</MenuItem>
          <MenuItem value="pg">카드(PG)</MenuItem>
        </TextField>
        <TextField
          size="small"
          type="search"
          placeholder="상호, 고객, 입금자로 찾기"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ htmlInput: { "aria-label": "결제 검색" } }}
        />
        <Typography variant="body2" sx={{ flex: 1, textAlign: { sm: "right" } }} data-testid="payments-total">
          {history.data
            ? q
              ? `검색 결과 입금 ${rows.filter((p) => !p.voided_at).length}건 · 합계 ${won(rows.filter((p) => !p.voided_at).reduce((n, p) => n + p.amount, 0))}${history.data.truncated ? ` (최근 ${history.data.payments.length}건 안에서만 찾음)` : ""} (기간 전체 ${won(history.data.total)})`
              : `입금 ${history.data.count}건 · 합계 ${won(history.data.total)}${history.data.voided ? ` (취소 ${history.data.voided}건 제외, 목록에는 표시)` : ""}`
            : ""}
        </Typography>
      </Stack>
      {history.data?.truncated ? (
        <Alert severity="info">
          이 기간의 결제가 많아 최근 {history.data.payments.length}건만 목록에 보이고 검색도 그 안에서만 합니다. 위의 기간 합계는 기간 전체 기준입니다. 기간을 좁혀 보세요.
        </Alert>
      ) : null}
      <ErrorAlert error={history.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={history.isLoading}
          autoHeight
          disableRowSelectionOnClick
          localeText={{ ...gridLocale, noRowsLabel: "이 기간의 결제가 없습니다" }}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
      {editing ? <EditPaymentDialog payment={editing} onClose={() => setEditing(null)} /> : null}
      {voiding ? <VoidPaymentDialog payment={voiding} onClose={() => setVoiding(null)} /> : null}
    </Stack>
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
          <DialogContentText variant="body2">
            이용 기간을 바꾸면 공개 여부도 바로 다시 계산됩니다(기간이 끝나고 14일이 지나면 공개 중단).
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
                    <Button size="small" onClick={() => setInvoice(today())}>
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

function VoidPaymentDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => api(`/payments/${payment.id}/void`, { method: "POST", json: { reason } }),
    onSuccess: () => {
      toast("결제를 취소했습니다");
      void queryClient.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>결제 취소</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          {payment.paid_on} {won(payment.amount)} 입금을 취소합니다. 기록은 남지만 이용 기간에서 빠지며, 납부 기간이 없으면 사이트 공개가 중단됩니다.
        </DialogContentText>
        <TextField fullWidth label="취소 사유" value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { name: "voidReason" } }} />
        <ErrorAlert error={run.error} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button color="error" variant="contained" disabled={!reason.trim() || run.isPending} onClick={() => run.mutate()}>
          결제 취소
        </Button>
      </DialogActions>
    </Dialog>
  );
}

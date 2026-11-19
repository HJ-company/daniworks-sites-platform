import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
import { BillingChip, billingSummary } from "./billing-ui.js";
import { EditPaymentDialog, PaymentDialog } from "./payment-dialog.js";

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
  // Opens on this month: the question asked most ("이번 달 얼마 들어왔지?").
  const [monthStart, monthEnd] = monthRange(0);
  const from = params.has("from") ? params.get("from")! : monthStart;
  const to = params.has("to") ? params.get("to")! : monthEnd;
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
    { field: "confirmed_by", headerName: "확인", width: 100, valueGetter: (v) => v ?? "-" },
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

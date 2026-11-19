import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { api, won, type Customer, type CustomerSummary } from "../api.js";
import { ErrorAlert, useToast } from "../ui.js";

const columns: GridColDef<CustomerSummary>[] = [
  {
    field: "name",
    headerName: "업체명",
    flex: 1,
    minWidth: 160,
    renderCell: ({ row }) => (
      <Link component={RouterLink} to={`/customers/${row.id}`} data-testid={`customer-link-${row.id}`}>
        {row.name}
      </Link>
    ),
  },
  { field: "contact_name", headerName: "담당자", width: 110, valueGetter: (v) => v ?? "-" },
  { field: "phone", headerName: "연락처", width: 140, valueGetter: (v) => v ?? "-" },
  { field: "site_names", headerName: "사이트", flex: 1, minWidth: 160, valueGetter: (v, row) => (row.site_count ? v : "-") },
  { field: "monthly_total", headerName: "월 청구", width: 120, valueGetter: (v: number) => won(v) },
  {
    field: "attention",
    headerName: "확인",
    width: 110,
    renderCell: ({ row }) => (row.attention ? <Chip size="small" color="warning" label={`결제 ${row.attention}건`} /> : null),
  },
];

const matches = (c: CustomerSummary, q: string) =>
  [c.name, c.contact_name, c.phone, c.site_names, c.business_number].some((v) => v?.toLowerCase().includes(q));

export function CustomersPage() {
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<{ customers: CustomerSummary[] }>("/customers") });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const q = search.trim().toLowerCase();
  const rows = (customers.data?.customers ?? []).filter((c) => !q || matches(c, q));
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          고객
        </Typography>
        <Button variant="outlined" onClick={() => setAdding(true)}>
          고객 추가
        </Button>
      </Stack>
      <TextField
        type="search"
        size="small"
        placeholder="업체명, 담당자, 연락처, 사이트로 찾기"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: 420 }}
        slotProps={{ htmlInput: { "aria-label": "고객 검색" } }}
      />
      <ErrorAlert error={customers.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={customers.isLoading}
          autoHeight
          disableRowSelectionOnClick
          localeText={{ noRowsLabel: "고객이 없습니다" }}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
      {adding ? <CustomerDialog onClose={() => setAdding(false)} /> : null}
    </Stack>
  );
}

const FIELDS: { key: keyof Customer; body: string; label: string; helper?: string }[] = [
  { key: "name", body: "name", label: "업체명(필수)" },
  { key: "contact_name", body: "contactName", label: "담당자(사장님)" },
  { key: "phone", body: "phone", label: "연락처" },
  { key: "email", body: "email", label: "이메일" },
  { key: "business_number", body: "businessNumber", label: "사업자등록번호", helper: "숫자 10자리" },
  { key: "invoice_email", body: "invoiceEmail", label: "세금계산서 이메일" },
  { key: "external_ref", body: "externalRef", label: "외부 리드 링크", helper: "노션 등 리드 페이지 주소" },
  { key: "memo", body: "memo", label: "메모" },
];

/** Add (no customer) or edit a customer. Only changed fields are sent on edit. */
export function CustomerDialog({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.body, (customer?.[f.key] as string | null | undefined) ?? ""])),
  );
  const changed = Object.fromEntries(
    FIELDS.filter((f) => values[f.body] !== ((customer?.[f.key] as string | null | undefined) ?? "")).map((f) => [f.body, values[f.body]]),
  );
  const save = useMutation({
    mutationFn: () =>
      customer
        ? api<{ customer: Customer }>(`/customers/${customer.id}`, { method: "PATCH", json: changed })
        : api<{ customer: Customer }>("/customers", { method: "POST", json: changed }),
    onSuccess: (data) => {
      toast(customer ? "고객 정보를 저장했습니다" : "고객을 추가했습니다");
      void queryClient.invalidateQueries();
      onClose();
      if (!customer) navigate(`/customers/${data.customer.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{customer ? "고객 정보" : "고객 추가"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {FIELDS.map((f) => (
            <TextField
              key={f.body}
              label={f.label}
              value={values[f.body]}
              helperText={f.helper}
              multiline={f.body === "memo"}
              minRows={f.body === "memo" ? 2 : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f.body]: e.target.value }))}
              slotProps={{ htmlInput: { name: f.body } }}
            />
          ))}
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !values.name?.trim() || !Object.keys(changed).length}>
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}

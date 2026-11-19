import { Box, Button, Chip, Link, Stack, TextField, Typography } from "@mui/material";
import { gridLocale } from "../grid-locale.js";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { api, won, type CustomerSummary } from "../api.js";
import { ErrorAlert } from "../ui.js";
import { CustomerDialog } from "./customer-dialog.js";

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
      <Typography variant="body2" color="text.secondary">
        고객(사장님)은 AI 도구가 시안을 만들면서 등록하거나, 여기서 직접 추가합니다. 같은 연락처의 고객이 있으면 알려 줍니다.
      </Typography>
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
          localeText={{ ...gridLocale, noRowsLabel: "고객이 없습니다" }}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
      {adding ? <CustomerDialog onClose={() => setAdding(false)} /> : null}
    </Stack>
  );
}

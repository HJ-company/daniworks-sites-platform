import { Box, Link, Stack, TextField, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { api, kst, type SiteSummary } from "../api.js";
import { ErrorAlert, StatusChip } from "../ui.js";
import { BillingChip } from "./billing/billing-ui.js";

const columns: GridColDef<SiteSummary>[] = [
  {
    field: "business_name",
    headerName: "상호",
    flex: 1.2,
    minWidth: 180,
    valueGetter: (_value, row) => row.business_name ?? row.slug,
    renderCell: ({ row }) => (
      <Stack sx={{ py: 0.75, lineHeight: 1.3 }}>
        <Link component={RouterLink} to={`/sites/${row.id}`} data-testid={`site-link-${row.slug}`} sx={{ fontWeight: 600 }}>
          {row.business_name ?? row.slug}
        </Link>
        <Typography variant="caption" color="text.secondary">
          {row.slug}
        </Typography>
      </Stack>
    ),
  },
  { field: "hostname", headerName: "대표 주소", flex: 1.2, minWidth: 200 },
  {
    field: "billing_status",
    headerName: "구독",
    width: 100,
    renderCell: ({ row }) => <BillingChip status={row.billing_status} />,
  },
  {
    field: "status",
    headerName: "상태",
    width: 100,
    renderCell: ({ row }) => <StatusChip status={row.status} cancelled={row.cancelled_at} unpublished={!row.published_version_id} />,
  },
  {
    field: "published_number",
    headerName: "게시 / 최신",
    width: 110,
    valueGetter: (_value, row) => `${row.published_number ? `v${row.published_number}` : "-"} / v${row.latest_number ?? "-"}`,
  },
  { field: "notify_email", headerName: "문의 알림", flex: 1, minWidth: 160, valueGetter: (value) => value ?? "-" },
  { field: "updated_at", headerName: "변경(KST)", width: 150, valueGetter: (value: string) => kst(value) },
];

/** Case-insensitive match on business name, slug and address. */
const matches = (site: SiteSummary, query: string) =>
  [site.business_name, site.slug, site.hostname, site.customer_name].some((value) => value?.toLowerCase().includes(query));

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api<{ sites: SiteSummary[] }>("/sites") });
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const rows = (sites.data?.sites ?? []).filter((site) => !query || matches(site, query));
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        사이트
      </Typography>
      <TextField
        type="search"
        size="small"
        placeholder="상호, 영문 주소, 도메인, 고객으로 찾기"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ maxWidth: 420 }}
        slotProps={{ htmlInput: { "aria-label": "사이트 검색" } }}
      />
      <ErrorAlert error={sites.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={sites.isLoading}
          autoHeight
          disableRowSelectionOnClick
          getRowHeight={() => "auto"}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
    </Stack>
  );
}

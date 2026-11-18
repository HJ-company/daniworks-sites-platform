import { Box, Link, Stack, Typography } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router";
import { api, kst, type SiteSummary } from "../api.js";
import { ErrorAlert, StatusChip } from "../ui.js";

const columns: GridColDef<SiteSummary>[] = [
  {
    field: "slug",
    headerName: "사이트",
    flex: 1,
    minWidth: 160,
    renderCell: ({ row }) => (
      <Link component={RouterLink} to={`/sites/${row.id}`} data-testid={`site-link-${row.slug}`}>
        {row.slug}
      </Link>
    ),
  },
  { field: "hostname", headerName: "대표 주소", flex: 1.2, minWidth: 200 },
  {
    field: "status",
    headerName: "상태",
    width: 100,
    renderCell: ({ row }) => <StatusChip status={row.status} cancelled={row.cancelled_at} />,
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

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api<{ sites: SiteSummary[] }>("/sites") });
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        사이트
      </Typography>
      <ErrorAlert error={sites.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          rows={sites.data?.sites ?? []}
          columns={columns}
          loading={sites.isLoading}
          autoHeight
          disableRowSelectionOnClick
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
    </Stack>
  );
}

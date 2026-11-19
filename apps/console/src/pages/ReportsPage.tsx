import { Box, Button, Link, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { gridLocale } from "../grid-locale.js";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { api, METRIC_LABELS, METRIC_ORDER, type QuarterlyOverview } from "../api.js";
import { recentQuarters } from "../quarters.js";
import { ErrorAlert, StatusChip } from "../ui.js";

type Row = QuarterlyOverview["sites"][number];

const columnsFor = (quarter: string): GridColDef<Row>[] => [
  {
    field: "slug",
    headerName: "사이트",
    flex: 1,
    minWidth: 150,
    renderCell: ({ row }) => (
      <Link component={RouterLink} to={`/sites/${row.id}/stats?quarter=${quarter}`}>
        {row.slug}
      </Link>
    ),
  },
  { field: "status", headerName: "상태", width: 90, renderCell: ({ row }) => <StatusChip status={row.status} cancelled={row.status === "cancelled" ? "y" : null} /> },
  ...METRIC_ORDER.map<GridColDef<Row>>((event) => ({
    field: event,
    headerName: METRIC_LABELS[event],
    type: "number",
    width: 96,
    valueGetter: (_value, row) => row.totals[event],
  })),
];

/** Operator-side CSV of every site's quarter (the customer reports are built from it). */
function downloadCsv(report: QuarterlyOverview) {
  const header = ["사이트", "주소", "상태", ...METRIC_ORDER.map((e) => METRIC_LABELS[e])];
  const lines = report.sites.map((s) => [s.slug, s.hostname, s.status, ...METRIC_ORDER.map((e) => s.totals[e])].join(","));
  const blob = new Blob([`﻿${[header.join(","), ...lines].join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quarterly-${report.quarter}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportsPage() {
  const quarters = recentQuarters();
  // The quarter lives in the URL so drill-down to a site keeps the same period.
  const [params, setParams] = useSearchParams();
  const quarter = params.get("quarter") ?? quarters[0]!;
  const setQuarter = (q: string) => setParams({ quarter: q });
  const columns = useMemo(() => columnsFor(quarter), [quarter]);
  const report = useQuery({ queryKey: ["overview", quarter], queryFn: () => api<QuarterlyOverview>(`/reports/quarterly?quarter=${quarter}`) });
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          분기 리포트
        </Typography>
        <TextField select size="small" label="분기" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
          {quarters.map((q) => (
            <MenuItem key={q} value={q}>
              {q}
            </MenuItem>
          ))}
        </TextField>
        <Button sx={{ ml: "auto" }} disabled={!report.data} onClick={() => report.data && downloadCsv(report.data)} data-testid="overview-csv">
          전체 CSV
        </Button>
      </Stack>
      <ErrorAlert error={report.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid rows={report.data?.sites ?? []} columns={columns} loading={report.isLoading} autoHeight disableRowSelectionOnClick localeText={gridLocale} />
      </Box>
    </Stack>
  );
}

import {
  Button,
  Card,
  CardContent,
  Grid,
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
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, METRIC_LABELS, METRIC_ORDER, type QuarterlyReport } from "../../api.js";
import { recentQuarters } from "../../quarters.js";
import { ErrorAlert } from "../../ui.js";

const change = (now: number, before: number) => {
  if (!before) return now ? "신규" : "-";
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
};

export function StatsTab({ siteId }: { siteId: string }) {
  const quarters = recentQuarters();
  // Shared with the reports page through the URL (?quarter=2026-Q3).
  const [params, setParams] = useSearchParams();
  const quarter = params.get("quarter") ?? quarters[0]!;
  const setQuarter = (q: string) => setParams({ quarter: q });
  const report = useQuery({
    queryKey: ["quarterly", siteId, quarter],
    queryFn: () => api<QuarterlyReport>(`/sites/${siteId}/reports/quarterly?quarter=${quarter}`),
  });
  if (report.error) return <ErrorAlert error={report.error} />;
  const data = report.data;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <TextField select size="small" label="분기" value={quarter} onChange={(e) => setQuarter(e.target.value)} slotProps={{ htmlInput: { "data-testid": "quarter" } }}>
          {quarters.map((q) => (
            <MenuItem key={q} value={q}>
              {q}
            </MenuItem>
          ))}
        </TextField>
        {data ? (
          <Typography variant="body2" color="text.secondary">
            {data.from} ~ {data.to} (한국 날짜) · 직전 {data.previous.quarter} 대비
          </Typography>
        ) : null}
        <Button href={`/api/sites/${siteId}/reports/quarterly.csv?quarter=${quarter}`} sx={{ ml: "auto" }} data-testid="report-csv">
          CSV
        </Button>
      </Stack>
      {data ? (
        <>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card variant="outlined" data-testid="metric-conversions">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    연락 전환(전화·카톡·지도·예약·문의)
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>
                    {data.conversions.toLocaleString("ko-KR")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {change(data.conversions, data.previous.conversions)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            {METRIC_ORDER.map((event) => (
              <Grid key={event} size={{ xs: 6, sm: 4, md: 2 }}>
                <Card variant="outlined" data-testid={`metric-${event}`}>
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {METRIC_LABELS[event]}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                      {data.totals[event].toLocaleString("ko-KR")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {change(data.totals[event], data.previous.totals[event])}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Paper>
            <Table size="small" data-testid="monthly">
              <TableHead>
                <TableRow>
                  <TableCell>월</TableCell>
                  {METRIC_ORDER.map((event) => (
                    <TableCell key={event} align="right">
                      {METRIC_LABELS[event]}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.monthly.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    {METRIC_ORDER.map((event) => (
                      <TableCell key={event} align="right">
                        {row[event].toLocaleString("ko-KR")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}

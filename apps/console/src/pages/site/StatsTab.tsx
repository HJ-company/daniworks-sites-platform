import { Card, CardContent, Grid, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, type MetricEvent, type MetricsReport } from "../../api.js";
import { ErrorAlert } from "../../ui.js";

const LABELS: Record<MetricEvent, string> = {
  pageview: "방문",
  tel: "전화",
  kakao: "카톡",
  map: "지도",
  booking: "예약",
  inquiry_cta: "문의 버튼",
  inquiry: "문의 접수",
};

export function StatsTab({ siteId }: { siteId: string }) {
  const report = useQuery({ queryKey: ["metrics", siteId], queryFn: () => api<MetricsReport>(`/sites/${siteId}/metrics`) });
  if (report.error) return <ErrorAlert error={report.error} />;
  if (!report.data) return null;
  return (
    <Stack spacing={2}>
      <Typography color="text.secondary" variant="body2">
        최근 30일 ({report.data.from} ~ {report.data.to}, 한국 날짜)
      </Typography>
      <Grid container spacing={2}>
        {(Object.keys(LABELS) as MetricEvent[]).map((event) => (
          <Grid key={event} size={{ xs: 6, sm: 4, md: 3 }}>
            <Card variant="outlined" data-testid={`metric-${event}`}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">
                  {LABELS[event]}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                  {report.data.totals[event].toLocaleString("ko-KR")}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}

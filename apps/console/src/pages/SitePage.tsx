import { Box, LinearProgress, Link, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type SiteRow, type VersionRow } from "../api.js";
import { ErrorAlert, StatusChip } from "../ui.js";
import { OverviewTab } from "./site/OverviewTab.js";

// Heavy tabs (CodeMirror, DataGrid) load on first use.
const EditTab = lazy(() => import("./site/EditTab.js").then((m) => ({ default: m.EditTab })));
const PhotosTab = lazy(() => import("./site/PhotosTab.js").then((m) => ({ default: m.PhotosTab })));
const DomainsTab = lazy(() => import("./site/DomainsTab.js").then((m) => ({ default: m.DomainsTab })));
const InquiriesTab = lazy(() => import("./site/InquiriesTab.js").then((m) => ({ default: m.InquiriesTab })));
const StatsTab = lazy(() => import("./site/StatsTab.js").then((m) => ({ default: m.StatsTab })));

const TABS = [
  { id: "", label: "개요·버전" },
  { id: "edit", label: "편집" },
  { id: "photos", label: "사진" },
  { id: "domains", label: "도메인" },
  { id: "inquiries", label: "문의" },
  { id: "stats", label: "통계" },
] as const;

export function useSite(siteId: string) {
  return useQuery({
    queryKey: ["site", siteId],
    queryFn: () => api<{ site: SiteRow; versions: VersionRow[] }>(`/sites/${siteId}`),
  });
}

export function SitePage() {
  const { siteId = "", tab = "" } = useParams();
  const navigate = useNavigate();
  const site = useSite(siteId);
  const domains = useQuery({
    queryKey: ["domains", siteId],
    queryFn: () => api<{ domains: { hostname: string; kind: string; status: string }[] }>(`/sites/${siteId}/domains`),
  });
  const primary =
    domains.data?.domains.find((d) => d.kind === "custom" && d.status === "active")?.hostname ??
    domains.data?.domains.find((d) => d.kind === "subdomain")?.hostname;

  if (site.error) return <ErrorAlert error={site.error} />;
  if (!site.data) return null;
  const { site: row } = site.data;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }} data-testid="site-title">
          {row.slug}
        </Typography>
        <StatusChip status={row.status} cancelled={row.cancelled_at} />
        {primary ? (
          <Link href={`https://${primary}`} target="_blank" rel="noopener" variant="body2">
            {primary}
          </Link>
        ) : null}
      </Stack>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={tab} onChange={(_, value: string) => navigate(`/sites/${siteId}${value ? `/${value}` : ""}`)} variant="scrollable">
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} data-testid={`tab-${t.id || "overview"}`} />
          ))}
        </Tabs>
      </Box>
      {tab === "" && <OverviewTab siteId={siteId} site={row} versions={site.data.versions} />}
      <Suspense fallback={<LinearProgress />}>
        {tab === "edit" && <EditTab siteId={siteId} />}
        {tab === "photos" && <PhotosTab siteId={siteId} />}
        {tab === "domains" && <DomainsTab siteId={siteId} />}
        {tab === "inquiries" && <InquiriesTab siteId={siteId} />}
        {tab === "stats" && <StatsTab siteId={siteId} />}
      </Suspense>
    </Stack>
  );
}

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  IconButton,
  LinearProgress,
  Link,
  OutlinedInput,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { api, kst, type SiteSummary } from "../api.js";
import { ErrorAlert, StatusChip } from "../ui.js";
import { BillingChip } from "./billing/billing-ui.js";
import { TodayPanel } from "./TodayPanel.js";

/** Case-insensitive match on business name, slug, address and customer. */
const matches = (site: SiteSummary, query: string) =>
  [site.business_name, site.slug, site.hostname, site.customer_name].some((value) => value?.toLowerCase().includes(query));

const PER_PAGE = 25;

/**
 * The first screen, kept light: a plain table (not the data grid), a plain search input and
 * previous/next paging (TextField and TablePagination would bring in Select, Modal and Popover).
 */
export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => api<{ sites: SiteSummary[] }>("/sites") });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = search.trim().toLowerCase();
  const rows = (sites.data?.sites ?? []).filter((site) => !query || matches(site, query));
  const shown = rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const lastPage = Math.max(0, Math.ceil(rows.length / PER_PAGE) - 1);
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        사이트
      </Typography>
      <Typography variant="body2" color="text.secondary" data-testid="create-hint">
        새 사이트는 AI 도구(Claude·ChatGPT)로 만듭니다. AI가 고객 등록부터 시안 링크까지 하고, 운영자는 여기서 검수·입금 확인·게시합니다.{" "}
        <Link component={RouterLink} to="/ai-tools">
          AI 도구 연결 방법
        </Link>
      </Typography>
      <TodayPanel />
      <OutlinedInput
        type="search"
        size="small"
        placeholder="상호, 영문 주소, 도메인, 고객으로 찾기"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        sx={{ maxWidth: 420, bgcolor: "background.paper" }}
        inputProps={{ "aria-label": "사이트 검색" }}
      />
      <ErrorAlert error={sites.error} />
      <Paper>
        {sites.isLoading ? <LinearProgress /> : null}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>상호</TableCell>
                <TableCell>대표 주소</TableCell>
                <TableCell>구독</TableCell>
                <TableCell>상태</TableCell>
                <TableCell>게시 / 최신</TableCell>
                <TableCell>문의 알림</TableCell>
                <TableCell>변경(KST)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/sites/${row.id}`} data-testid={`site-link-${row.slug}`} sx={{ fontWeight: 600 }}>
                      {row.business_name ?? row.slug}
                    </Link>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {row.slug}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.hostname}</TableCell>
                  <TableCell>
                    <BillingChip status={row.billing_status} />
                  </TableCell>
                  <TableCell>
                    <StatusChip status={row.status} cancelled={row.cancelled_at} unpublished={!row.published_version_id} />
                  </TableCell>
                  <TableCell>{`${row.published_number ? `v${row.published_number}` : "-"} / v${row.latest_number ?? "-"}`}</TableCell>
                  <TableCell>{row.notify_email ?? "-"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{kst(row.updated_at)}</TableCell>
                </TableRow>
              ))}
              {!shown.length && !sites.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      {query ? "찾는 사이트가 없습니다." : "아직 사이트가 없습니다. AI 도구로 첫 사이트를 만들어 보세요."}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end", px: 2, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {rows.length ? `${page * PER_PAGE + 1}–${Math.min(rows.length, (page + 1) * PER_PAGE)} / 전체 ${rows.length}` : "전체 0"}
          </Typography>
          <IconButton size="small" aria-label="이전 쪽" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label="다음 쪽" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Paper>
    </Stack>
  );
}

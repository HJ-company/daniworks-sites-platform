import { Box, Chip, Link, Paper, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { api, kst, type QueueRow } from "../api.js";
import { billingSummary } from "./billing/billing-ui.js";

interface Brief {
  id: string;
  slug: string;
  business_name: string | null;
}
interface Today {
  billing: QueueRow[];
  manualSuspensions: (Brief & { reason: string | null; since: string | null })[];
  drafts: (Brief & { draft: "no-link" | "expired" | "sent" | "billed" | "paid" })[];
  domains: (Brief & { hostname: string; status: string })[];
  unlinked: Brief[];
}

const DRAFT: Record<string, string> = {
  "no-link": "시안 링크를 아직 안 만듦",
  expired: "시안 링크 만료",
  sent: "사장님 확인 기다림",
  paid: "입금 완료 · 게시 기다림",
};

function Section({ title, count, children, testid }: { title: string; count: number; children: ReactNode; testid: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid={testid}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
        </Typography>
        <Chip size="small" label={count} color="warning" />
      </Stack>
      <Stack spacing={0.5}>{children}</Stack>
    </Paper>
  );
}

function Item({ site, note }: { site: Brief; note: string }) {
  return (
    <Typography variant="body2">
      <Link component={RouterLink} to={`/sites/${site.id}`}>
        {site.business_name ?? site.slug}
      </Link>{" "}
      <Typography component="span" variant="caption" color="text.secondary">
        {note}
      </Typography>
    </Typography>
  );
}

const MAX = 5;

/** A section's first few rows, then "외 n곳 더 보기" to open the rest. */
function List<T>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? rows : rows.slice(0, MAX)).map(render)}
      {rows.length > MAX ? (
        <Link component="button" variant="caption" sx={{ alignSelf: "flex-start" }} onClick={() => setAll((v) => !v)}>
          {all ? "접기" : `외 ${rows.length - MAX}곳 더 보기`}
        </Link>
      ) : null}
    </>
  );
}

/** What needs the operator today, gathered from billing, sites, drafts and domains. */
export function TodayPanel() {
  const today = useQuery({ queryKey: ["today"], queryFn: () => api<Today>("/today") });
  if (!today.data) return null;
  const { billing, manualSuspensions, domains, unlinked } = today.data;
  const drafts = today.data.drafts.filter((d) => d.draft !== "billed"); // billed drafts are under 결제
  const total = billing.length + manualSuspensions.length + drafts.length + domains.length + unlinked.length;
  return (
    <Stack spacing={1} data-testid="today">
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        오늘 할 일 {total ? `(${total})` : ""}
      </Typography>
      {!total ? (
        <Typography variant="body2" color="text.secondary">
          오늘 처리할 일이 없습니다.
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" } }}>
          {billing.length ? (
            <Section title="결제" count={billing.length} testid="today-billing">
              <List
                rows={billing}
                render={(row) => (
                  <Item key={row.site_id} site={{ id: row.site_id, slug: row.slug, business_name: row.business_name }} note={billingSummary(row)} />
                )}
              />
              <Link component={RouterLink} to="/payments" variant="caption">
                결제 화면에서 처리
              </Link>
            </Section>
          ) : null}
          {manualSuspensions.length ? (
            <Section title="운영자가 공개 정지" count={manualSuspensions.length} testid="today-suspended">
              <List
                rows={manualSuspensions}
                render={(row) => (
                  <Item key={row.id} site={row} note={`${row.since ? `${kst(row.since).slice(0, 10)}부터 · ` : ""}${row.reason ?? "사유 없음"}`} />
                )}
              />
            </Section>
          ) : null}
          {drafts.length ? (
            <Section title="공개 전" count={drafts.length} testid="today-drafts">
              <List rows={drafts} render={(row) => <Item key={row.id} site={row} note={DRAFT[row.draft] ?? ""} />} />
            </Section>
          ) : null}
          {domains.length ? (
            <Section title="도메인 연결" count={domains.length} testid="today-domains">
              <List
                rows={domains}
                render={(row) => (
                  <Item
                    key={row.hostname}
                    site={row}
                    note={`${row.hostname} · ${row.status === "failed" ? "연결 실패" : "사장님 DNS 설정 기다림"}`}
                  />
                )}
              />
            </Section>
          ) : null}
          {unlinked.length ? (
            <Section title="고객 미연결" count={unlinked.length} testid="today-unlinked">
              <List rows={unlinked} render={(row) => <Item key={row.id} site={row} note="연락할 사장님이 연결되지 않음" />} />
            </Section>
          ) : null}
        </Box>
      )}
    </Stack>
  );
}

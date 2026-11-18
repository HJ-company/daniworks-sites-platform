import {
  Button,
  Chip,
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, kst, type SiteRow, type VersionRow } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";
import { LifecycleCard } from "./LifecycleCard.js";

const CREATOR: Record<string, string> = { ai: "AI", operator: "운영자", customer: "고객" };

export function OverviewTab({ siteId, site, versions }: { siteId: string; site: SiteRow; versions: VersionRow[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [notify, setNotify] = useState(site.notify_email ?? "");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["sites"] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown; done: string }) =>
      api(`/sites/${siteId}/${path}`, { method: "POST", json: body ?? {} }),
    onSuccess: (_, { done }) => {
      toast(done);
      refresh();
    },
  });
  const saveNotify = useMutation({
    mutationFn: () => api(`/sites/${siteId}`, { method: "PATCH", json: { notifyEmail: notify } }),
    onSuccess: () => {
      toast("알림 이메일을 저장했습니다");
      refresh();
    },
  });

  return (
    <Stack spacing={2}>
      <ErrorAlert error={action.error ?? saveNotify.error} />
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
          <TextField
            size="small"
            label="문의 알림 이메일"
            value={notify}
            onChange={(e) => setNotify(e.target.value)}
            sx={{ minWidth: 280 }}
            slotProps={{ htmlInput: { name: "notifyEmail" } }}
          />
          <Button onClick={() => saveNotify.mutate()} disabled={saveNotify.isPending}>
            저장
          </Button>
          <Stack direction="row" sx={{ flex: 1, justifyContent: "flex-end" }}>
            {site.cancelled_at ? null : site.status === "active" ? (
              <Button color="warning" onClick={() => action.mutate({ path: "suspend", done: "공개를 정지했습니다" })}>
                공개 정지
              </Button>
            ) : (
              <Button color="success" onClick={() => action.mutate({ path: "resume", done: "공개를 재개했습니다" })}>
                공개 재개
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>
      <LifecycleCard siteId={siteId} site={site} />
      <Paper>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
          버전
        </Typography>
        <Table size="small" data-testid="versions">
          <TableHead>
            <TableRow>
              <TableCell>버전</TableCell>
              <TableCell>작성</TableCell>
              <TableCell>메모</TableCell>
              <TableCell>만든 때(KST)</TableCell>
              <TableCell align="right">작업</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((v) => {
              const live = v.id === site.published_version_id;
              return (
                <TableRow key={v.id} data-testid={`version-${v.number}`}>
                  <TableCell>
                    v{v.number} {live ? <Chip size="small" color="success" label="공개 중" /> : null}
                  </TableCell>
                  <TableCell>{CREATOR[v.created_by] ?? v.created_by}</TableCell>
                  <TableCell>{v.note ?? ""}</TableCell>
                  <TableCell>{kst(v.created_at)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                      <Button size="small" href={v.preview_url} target="_blank">
                        프리뷰
                      </Button>
                      {!live && v.first_published_at ? (
                        <Button
                          size="small"
                          onClick={() => action.mutate({ path: "rollback", body: { versionId: v.id }, done: `v${v.number}로 되돌렸습니다` })}
                        >
                          롤백
                        </Button>
                      ) : null}
                      {!live && !v.first_published_at ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => action.mutate({ path: "publish", body: { versionId: v.id }, done: `v${v.number}을 게시했습니다` })}
                        >
                          게시
                        </Button>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </Stack>
  );
}

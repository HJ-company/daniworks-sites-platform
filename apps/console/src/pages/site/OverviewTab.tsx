import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
import { DraftLinkCard } from "./DraftLinkCard.js";
import { LifecycleCard } from "./LifecycleCard.js";
import { SubscriptionCard, useSubscription } from "./SubscriptionCard.js";

const CREATOR: Record<string, string> = { ai: "AI", operator: "운영자", customer: "고객" };

export function OverviewTab({ siteId, site, versions }: { siteId: string; site: SiteRow; versions: VersionRow[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [notify, setNotify] = useState(site.notify_email ?? "");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const cancelled = Boolean(site.cancelled_at);
  const billing = useSubscription(siteId).data?.subscription;
  // Publishing follows billing: no exceptions before a payment is confirmed.
  const unpaid = billing ? !billing.canPublish : false;
  const blocked = cancelled || unpaid;
  // Publishing, suspending and resuming can change billing-driven serving too.
  const refresh = () => void queryClient.invalidateQueries();
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
      {site.published_version_id ? null : <DraftLinkCard siteId={siteId} site={site} />}
      <SubscriptionCard siteId={siteId} site={site} />
      {site.published_version_id ? <DraftLinkCard siteId={siteId} site={site} /> : null}
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
            {cancelled || (site.status === "active" && !site.published_version_id) || site.suspend_reason === "billing" ? null : site.status === "active" ? (
              <Button color="warning" onClick={() => setConfirmSuspend(true)}>
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
      <Dialog open={confirmSuspend} onClose={() => setConfirmSuspend(false)}>
        <DialogTitle>공개 정지</DialogTitle>
        <DialogContent>
          <DialogContentText>
            방문자에게는 상호와 "준비 중" 안내만 보입니다. 데이터와 도메인은 그대로이고, 공개 재개로 바로 되돌릴 수 있습니다.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSuspend(false)}>닫기</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setConfirmSuspend(false);
              action.mutate({ path: "suspend", done: "공개를 정지했습니다" });
            }}
          >
            정지
          </Button>
        </DialogActions>
      </Dialog>
      <LifecycleCard siteId={siteId} site={site} />
      <Paper>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
          버전
        </Typography>
        {unpaid && !cancelled ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 0.5 }} data-testid="publish-blocked">
            입금이 확인된 기간에만 게시·롤백할 수 있습니다. 위 구독에서 입금을 확인하세요.
          </Typography>
        ) : null}
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
                    v{v.number}{" "}
                    {live ? (
                      site.status === "suspended" ? (
                        <Chip size="small" color="warning" label="게시됨 · 공개 중단" />
                      ) : (
                        <Chip size="small" color="success" label="공개 중" />
                      )
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {CREATOR[v.created_by] ?? v.created_by}
                    {v.author ? ` · ${v.author}` : ""}
                  </TableCell>
                  <TableCell>{v.note ?? ""}</TableCell>
                  <TableCell>{kst(v.created_at)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                      <Button size="small" href={v.preview_url} target="_blank" title="운영자 검수용 버전 미리보기입니다. 사장님께는 시안 링크를 보내세요">
                        내부 미리보기
                      </Button>
                      {!live && v.first_published_at ? (
                        <Button
                          size="small"
                          disabled={blocked}
                          onClick={() => action.mutate({ path: "rollback", body: { versionId: v.id }, done: `v${v.number}로 되돌렸습니다` })}
                        >
                          롤백
                        </Button>
                      ) : null}
                      {!live && !v.first_published_at ? (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={blocked}
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

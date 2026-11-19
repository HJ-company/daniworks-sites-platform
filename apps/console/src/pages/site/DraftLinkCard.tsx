import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, kst, type DraftLink, type SiteRow } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";

/** Message the operator pastes into KakaoTalk with the draft link. */
export function draftMessage(name: string, link: DraftLink) {
  return [
    "[홈페이지 시안 안내]",
    `사장님, ${name} 홈페이지 시안을 준비했습니다. 아래 링크에서 휴대폰으로 확인해 주세요.`,
    "",
    link.url,
    "",
    `링크는 ${kst(link.expiresAt).slice(0, 10)}까지 열립니다. 고칠 부분은 편하게 말씀해 주세요. 시안을 고쳐도 링크는 그대로입니다.`,
  ].join("\n");
}

/** The customer's draft link: one per site, always the latest version, 30 days. */
export function DraftLinkCard({ siteId, site }: { siteId: string; site: SiteRow }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"reissue" | "revoke" | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const link = site.draft_link;
  const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast(done));
  const change = useMutation({
    mutationFn: (action: "issue" | "revoke") =>
      api<{ draftLink: DraftLink | null }>(`/sites/${siteId}/draft-link`, { method: action === "issue" ? "POST" : "DELETE", json: {} }),
    onSuccess: (_, action) => {
      setConfirm(null);
      toast(action === "issue" ? "시안 링크를 만들었습니다" : "시안 링크를 막았습니다");
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["audit", siteId] });
    },
  });
  if (site.cancelled_at) return null;
  return (
    <Paper sx={{ p: 2 }} data-testid="draft-link-card">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          사장님용 시안 링크
        </Typography>
        {!link ? (
          <Button variant="contained" onClick={() => change.mutate("issue")} disabled={change.isPending}>
            시안 링크 만들기
          </Button>
        ) : (
          <>
            <Button href={link.url} target="_blank" rel="noopener" disabled={link.expired}>
              열기
            </Button>
            <Button onClick={() => setConfirm("reissue")}>새 링크로 바꾸기</Button>
            <Button color="error" onClick={() => setConfirm("revoke")}>
              링크 막기
            </Button>
          </>
        )}
      </Stack>
      {site.draft_todos > 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }} data-testid="draft-todos">
          시안에 아직 채우지 않은 문구 "(작성 필요)"가 {site.draft_todos}곳 있습니다. 사장님께 보내기 전에 편집에서 채우세요.
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, fontFamily: "monospace", fontSize: 12 }} data-testid="draft-todo-fields">
            {site.draft_todo_fields.slice(0, 8).map((field) => (
              <li key={field}>{field}</li>
            ))}
            {site.draft_todo_fields.length > 8 ? <li>외 {site.draft_todo_fields.length - 8}곳</li> : null}
          </Box>
        </Alert>
      ) : null}
      {link ? (
        <>
          <Typography variant="body2" sx={{ mt: 1, wordBreak: "break-all" }} data-testid="draft-link-url">
            {link.url}
          </Typography>
          {link.expired ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              만료된 링크입니다({kst(link.expiresAt).slice(0, 10)}). 사장님께 다시 보내려면 새 링크로 바꾸세요.
            </Alert>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {kst(link.expiresAt).slice(0, 10)}까지 열림 · 항상 최신 버전을 보여줍니다(시안을 고쳐도 링크는 그대로). 문의는 전송되지 않고 방문 통계에도 잡히지 않습니다.
            </Typography>
          )}
          {!link.expired ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copy(link.url, "시안 링크를 복사했습니다")}>
                링크 복사
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ContentCopyIcon />}
                onClick={() => copy(draftMessage(site.business_name ?? site.slug, link), "사장님께 보낼 안내문을 복사했습니다")}
              >
                안내문 복사
              </Button>
              <Button size="small" onClick={() => setShowMessage((v) => !v)} aria-expanded={showMessage}>
                {showMessage ? "안내문 접기" : "안내문 보기"}
              </Button>
            </Stack>
          ) : null}
          {showMessage && !link.expired ? (
            <Box
              component="pre"
              data-testid="draft-message"
              sx={{ mt: 1, mb: 0, p: 1.5, bgcolor: "grey.100", borderRadius: 1, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14 }}
            >
              {draftMessage(site.business_name ?? site.slug, link)}
            </Box>
          ) : null}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          아직 링크가 없습니다. 만들면 30일 동안 열리고, 사장님은 공개 전 홈페이지를 휴대폰으로 볼 수 있습니다.
        </Typography>
      )}
      <ErrorAlert error={change.error} />
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm === "revoke" ? "시안 링크 막기" : "새 링크로 바꾸기"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === "revoke"
              ? "사장님께 보낸 링크가 더 이상 열리지 않습니다."
              : "예전 링크는 더 이상 열리지 않고, 새 링크가 30일 동안 열립니다. 새 링크를 사장님께 다시 보내야 합니다."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>닫기</Button>
          <Button
            variant="contained"
            color={confirm === "revoke" ? "error" : "primary"}
            onClick={() => change.mutate(confirm === "revoke" ? "revoke" : "issue")}
            disabled={change.isPending}
          >
            {confirm === "revoke" ? "막기" : "바꾸기"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

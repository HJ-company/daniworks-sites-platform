import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, kst, type SiteRow } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";

/** Export, cancel, reactivate and (after retention) purge. Destructive steps need the slug typed. */
export function LifecycleCard({ siteId, site }: { siteId: string; site: SiteRow }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"cancel" | "purge" | null>(null);
  const [typed, setTyped] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    void queryClient.invalidateQueries({ queryKey: ["sites"] });
    void queryClient.invalidateQueries({ queryKey: ["domains", siteId] });
  };
  const run = useMutation({
    mutationFn: ({ action }: { action: "cancel" | "reactivate" | "purge" }) =>
      api<{ purgeAfter?: string }>(`/sites/${siteId}/${action}`, { method: "POST", json: action === "purge" ? { confirmSlug: typed } : {} }),
    onSuccess: (data, { action }) => {
      setDialog(null);
      setTyped("");
      if (action === "purge") {
        toast("사이트를 완전히 삭제했습니다");
        void queryClient.invalidateQueries({ queryKey: ["sites"] });
        navigate("/");
        return;
      }
      toast(action === "cancel" ? `해지했습니다. ${kst(data.purgeAfter ?? null).slice(0, 10)} 이후 삭제할 수 있습니다` : "해지를 취소했습니다");
      refresh();
    },
  });
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          계약·데이터 {site.cancelled_at ? `· 해지 ${kst(site.cancelled_at)}` : ""}
        </Typography>
        <Button href={`/api/sites/${siteId}/export.zip`} data-testid="export">
          내보내기(zip)
        </Button>
        {site.cancelled_at ? (
          <>
            <Button onClick={() => run.mutate({ action: "reactivate" })}>해지 취소</Button>
            <Button color="error" onClick={() => setDialog("purge")}>
              완전 삭제
            </Button>
          </>
        ) : (
          <Button color="error" onClick={() => setDialog("cancel")}>
            해지
          </Button>
        )}
      </Stack>
      <ErrorAlert error={run.error} />
      <Dialog open={dialog !== null} onClose={() => setDialog(null)}>
        <DialogTitle>{dialog === "purge" ? "완전 삭제" : "해지"}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {dialog === "purge"
              ? "파일·문의·통계·버전이 모두 지워지고 되돌릴 수 없습니다. 먼저 내보내기를 받아 두세요."
              : "공개를 멈추고(410) 커스텀 도메인을 해제합니다. 데이터는 보관 기간 동안 남습니다."}
            {" "}확인을 위해 <b>{site.slug}</b>를 입력하세요.
          </DialogContentText>
          <TextField fullWidth size="small" value={typed} onChange={(e) => setTyped(e.target.value)} slotProps={{ htmlInput: { name: "confirmSlug" } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>닫기</Button>
          <Button color="error" variant="contained" disabled={typed !== site.slug || run.isPending} onClick={() => dialog && run.mutate({ action: dialog })}>
            {dialog === "purge" ? "완전 삭제" : "해지"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

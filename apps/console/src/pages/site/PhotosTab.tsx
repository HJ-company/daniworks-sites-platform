import {
  Button,
  Card,
  CardActions,
  CardContent,
  CardMedia,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Asset } from "../../api.js";
import { resizeForUpload } from "../../resize.js";
import { ErrorAlert, useToast } from "../../ui.js";

const PURPOSE_LABEL: Record<string, string> = { background: "배경", illustration: "일러스트", mood: "분위기", work: "작업물(고객 요청)" };

export function PhotosTab({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Asset | null>(null);
  const assets = useQuery({ queryKey: ["assets", siteId], queryFn: () => api<{ assets: Asset[] }>(`/sites/${siteId}/assets`) });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const blob = await resizeForUpload(file);
        await api(`/sites/${siteId}/assets`, {
          method: "POST",
          body: blob,
          headers: { "content-type": "image/jpeg", "x-file-name": encodeURIComponent(file.name) },
        });
      }
      return files.length;
    },
    onSuccess: async (count) => {
      toast(`${count}장을 올렸습니다`);
      await queryClient.invalidateQueries({ queryKey: ["assets", siteId] });
    },
  });
  const discard = useMutation({
    mutationFn: (asset: Asset) => api(`/sites/${siteId}/assets/${asset.key.split("/")[1]}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirm(null);
      toast("사진을 지웠습니다");
      await queryClient.invalidateQueries({ queryKey: ["assets", siteId] });
      await queryClient.invalidateQueries({ queryKey: ["audit", siteId] });
    },
  });
  const all = assets.data?.assets ?? [];
  const ai = all.filter((a) => a.source === "ai");
  const aiCost = ai.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0);
  const copy = async (asset: Asset) => {
    await navigator.clipboard.writeText(JSON.stringify({ key: asset.key, alt: "", width: asset.width, height: asset.height }));
    toast("설정에 넣을 사진 값을 복사했습니다");
  };
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Button variant="contained" component="label" disabled={upload.isPending}>
          {upload.isPending ? "올리는 중…" : "사진 올리기"}
          <input
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            data-testid="photo-input"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) upload.mutate(files);
              e.target.value = "";
            }}
          />
        </Button>
        <Typography variant="body2" color="text.secondary">
          브라우저에서 긴 변 1600px로 줄여 올립니다. 편집 탭의 사진 항목에 값을 붙여 넣으세요.
        </Typography>
      </Stack>
      {ai.length ? (
        <Typography variant="body2" color="text.secondary" data-testid="ai-summary">
          AI 이미지 {ai.length}장{aiCost ? ` · 생성 비용 약 $${aiCost.toFixed(2)}` : ""}. 실제 작업물 용도는 고객 요청이 있을 때만 만듭니다.
        </Typography>
      ) : null}
      <ErrorAlert error={assets.error ?? upload.error ?? discard.error} />
      <Grid container spacing={2}>
        {all.map((asset) => (
          <Grid key={asset.key} size={{ xs: 6, sm: 4, md: 3 }}>
            <Card variant="outlined" data-testid="photo-card">
              <CardMedia component="img" image={`/api${asset.url.replace(/\.jpg$/, ".w480.webp")}`} sx={{ aspectRatio: "4 / 3", objectFit: "cover" }} />
              <CardContent sx={{ py: 1 }}>
                <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mb: 0.5 }}>
                  {asset.source === "ai" ? (
                    <Tooltip title={asset.prompt ?? ""}>
                      <Chip size="small" color="secondary" label={`AI · ${PURPOSE_LABEL[asset.purpose ?? "mood"]}`} data-testid="ai-chip" />
                    </Tooltip>
                  ) : (
                    <Chip size="small" variant="outlined" label={asset.source === "url" ? "가져온 사진" : "올린 사진"} />
                  )}
                  {asset.in_use ? <Chip size="small" color="success" variant="outlined" label="사용 중" /> : null}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {asset.width}×{asset.height} · {Math.round(asset.bytes / 1024)}KB
                </Typography>
                {asset.customer_request ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} data-testid="customer-request">
                    고객 요청: {asset.customer_request.channel} {asset.customer_request.requestedAt} · {asset.customer_request.summary}
                  </Typography>
                ) : null}
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => void copy(asset)}>
                  값 복사
                </Button>
                <Tooltip title={asset.in_use ? "버전에서 쓰는 사진은 지울 수 없습니다" : ""}>
                  <span>
                    <Button size="small" color="error" disabled={asset.in_use} onClick={() => setConfirm(asset)}>
                      지우기
                    </Button>
                  </span>
                </Tooltip>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)}>
        <DialogTitle>사진 지우기</DialogTitle>
        <DialogContent>
          <DialogContentText>어느 버전에서도 쓰지 않는 사진입니다. 지우면 되돌릴 수 없습니다(같은 사진을 다시 올리면 됩니다).</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>닫기</Button>
          <Button color="error" variant="contained" disabled={discard.isPending} onClick={() => confirm && discard.mutate(confirm)}>
            지우기
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

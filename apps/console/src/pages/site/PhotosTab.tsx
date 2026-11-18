import { Button, Card, CardActions, CardContent, CardMedia, Grid, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Asset } from "../../api.js";
import { resizeForUpload } from "../../resize.js";
import { ErrorAlert, useToast } from "../../ui.js";

export function PhotosTab({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      <ErrorAlert error={assets.error ?? upload.error} />
      <Grid container spacing={2}>
        {(assets.data?.assets ?? []).map((asset) => (
          <Grid key={asset.key} size={{ xs: 6, sm: 4, md: 3 }}>
            <Card variant="outlined" data-testid="photo-card">
              <CardMedia component="img" image={`/api${asset.url.replace(/\.jpg$/, ".w480.webp")}`} sx={{ aspectRatio: "4 / 3", objectFit: "cover" }} />
              <CardContent sx={{ py: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {asset.width}×{asset.height} · {Math.round(asset.bytes / 1024)}KB
                </Typography>
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => void copy(asset)}>
                  값 복사
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}

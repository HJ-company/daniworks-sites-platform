import { Box, Chip, LinearProgress, Link, List, ListItemButton, ListItemText, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router";
import { api, kst, type GuideSummary } from "../api.js";
import { ErrorAlert } from "../ui.js";

const KIND: Record<string, string> = { schema: "스키마", policy: "상품·계약", industry: "업종", design: "디자인", writing: "작성 규칙" };

/** Headings, lists and code blocks are enough for these documents; the rest is plain text. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <Box sx={{ "& h2": { fontSize: 18, mt: 3, mb: 1 }, "& h1": { fontSize: 22, mt: 0, mb: 1 } }}>
      {blocks.map((block, i) =>
        i % 2 ? (
          <Box key={i} component="pre" sx={{ bgcolor: "grey.100", p: 1.5, overflow: "auto", fontSize: 12, borderRadius: 1, maxHeight: 420 }}>
            {block.replace(/^\w*\n/, "")}
          </Box>
        ) : (
          <Fragment key={i}>
            {block.split("\n").map((line, j) =>
              line.startsWith("# ") ? (
                <h1 key={j}>{line.slice(2)}</h1>
              ) : line.startsWith("## ") ? (
                <h2 key={j}>{line.slice(3)}</h2>
              ) : line.trim() ? (
                <Typography key={j} variant="body2" sx={{ whiteSpace: "pre-wrap", my: 0.25, pl: /^\s*[-\d|]/.test(line) ? 1 : 0 }}>
                  {line}
                </Typography>
              ) : null,
            )}
          </Fragment>
        ),
      )}
    </Box>
  );
}

/**
 * Authoring guides the AI tools follow. Read-only here: edits go through the AI tools
 * (guide_update), so every change is a version with its author.
 */
export function GuidesPage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const version = params.get("version");
  const list = useQuery({ queryKey: ["guides"], queryFn: () => api<{ guides: GuideSummary[] }>("/guides") });
  const guide = useQuery({
    queryKey: ["guide", slug, version],
    enabled: Boolean(slug),
    queryFn: () => api<{ guide: GuideSummary & { body: string; author?: string; note?: string; created_at?: string } }>(`/guides/${slug}${version ? `?version=${version}` : ""}`),
  });
  const history = useQuery({
    queryKey: ["guide-versions", slug],
    enabled: Boolean(slug) && slug !== "schema-site-config",
    queryFn: () => api<{ versions: { version: number; author: string | null; note: string | null; created_at: string }[] }>(`/guides/${slug}/versions`),
  });
  return (
    <Stack spacing={2}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        제작 지침
      </Typography>
      <Typography variant="body2" color="text.secondary">
        AI 도구가 사이트를 만들기 전에 읽는 문서입니다. 고칠 때는 AI 도구에 "작성 규칙의 '이미지 용도' 부분을 이렇게 바꿔 줘"처럼 말하면 됩니다. 고칠 때마다 누가 언제 고쳤는지 버전이 남습니다.
      </Typography>
      <ErrorAlert error={list.error ?? guide.error} />
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
        <Paper sx={{ width: { xs: "100%", md: 300 }, flexShrink: 0 }}>
          <List dense>
            {(list.data?.guides ?? []).map((g) => (
              <ListItemButton key={g.slug} component={RouterLink} to={`/guides/${g.slug}`} selected={g.slug === slug} data-testid={`guide-${g.slug}`}>
                <ListItemText primary={g.title} secondary={`${KIND[g.kind] ?? g.kind}${g.readOnly ? " · 코드 생성" : ` · v${g.version}`}`} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        <Paper sx={{ p: 2, flex: 1, minWidth: 0, width: "100%" }}>
          {!slug ? (
            <Typography color="text.secondary">왼쪽에서 문서를 고르세요.</Typography>
          ) : guide.isLoading ? (
            <LinearProgress />
          ) : guide.data ? (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Chip size="small" label={KIND[guide.data.guide.kind] ?? guide.data.guide.kind} />
                {guide.data.guide.kind === "schema" ? (
                  <Typography variant="caption" color="text.secondary">
                    코드에서 자동으로 만든 문서(읽기 전용)
                  </Typography>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary" data-testid="guide-version">
                      v{guide.data.guide.version} · {guide.data.guide.author ?? "-"} · {kst(guide.data.guide.created_at ?? null)}
                      {guide.data.guide.note ? ` · ${guide.data.guide.note}` : ""}
                    </Typography>
                    {history.data && history.data.versions.length > 1 ? (
                      <TextField
                        select
                        size="small"
                        label="버전"
                        value={version ?? String(history.data.versions[0]!.version)}
                        onChange={(e) => setParams(e.target.value === String(history.data!.versions[0]!.version) ? {} : { version: e.target.value })}
                        sx={{ minWidth: 220 }}
                      >
                        {history.data.versions.map((v) => (
                          <MenuItem key={v.version} value={String(v.version)}>
                            v{v.version} · {v.author ?? "-"} · {kst(v.created_at).slice(0, 10)}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : null}
                  </>
                )}
              </Stack>
              <Markdown text={guide.data.guide.body} />
            </Stack>
          ) : null}
        </Paper>
      </Stack>
      <Link component={RouterLink} to="/" variant="body2">
        사이트 목록으로
      </Link>
    </Stack>
  );
}

import { json } from "@codemirror/lang-json";
import { Alert, Button, Grid, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type VersionRow } from "../../api.js";
import { ErrorAlert, useToast } from "../../ui.js";

type Config = Record<string, unknown> & { business?: Record<string, unknown>; content?: Record<string, unknown> };

type Field = { path: string[]; label: string; half?: boolean; multiline?: boolean };

/** Fields edited by form (quick fixes); everything else through the JSON editor or the AI tools. Both edit one config. */
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "업체 정보",
    fields: [
      { path: ["business", "name"], label: "상호", half: true },
      { path: ["business", "phone"], label: "전화번호", half: true },
      { path: ["business", "representative"], label: "대표자", half: true },
      { path: ["business", "address"], label: "주소", half: true },
      { path: ["business", "kakaoUrl"], label: "카카오 채널·오픈채팅 URL" },
      { path: ["business", "mapUrl"], label: "지도 URL", half: true },
      { path: ["business", "bookingUrl"], label: "네이버 예약 URL", half: true },
      { path: ["business", "blogUrl"], label: "네이버 블로그 URL" },
    ],
  },
  {
    title: "첫 화면·검색 문구",
    fields: [
      { path: ["content", "hero", "kicker"], label: "첫 화면 작은 제목", half: true },
      { path: ["content", "hero", "heading"], label: "첫 화면 큰 제목 (줄바꿈 가능)", multiline: true },
      { path: ["content", "hero", "subheading"], label: "첫 화면 설명", multiline: true },
      { path: ["meta", "title"], label: "검색 결과 제목" },
      { path: ["meta", "description"], label: "검색 결과 설명", multiline: true },
    ],
  },
];

function getIn(config: Config | null, path: string[]): unknown {
  let node: unknown = config;
  for (const key of path) node = node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined;
  return node;
}

export function EditTab({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const latest = useQuery({
    queryKey: ["latest", siteId],
    queryFn: () => api<{ version: { number: number }; config: Config }>(`/sites/${siteId}/versions/latest`),
  });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  // Last config loaded from the server. A refetch (e.g. after saving) replaces the editor only
  // when the operator has not changed it since, so typing during a save is never lost.
  const loaded = useRef("");
  useEffect(() => {
    if (!latest.data) return;
    const incoming = JSON.stringify(latest.data.config, null, 2);
    setText((current) => (current === "" || current === loaded.current ? incoming : current));
    loaded.current = incoming;
  }, [latest.data]);

  const parsed = useMemo<{ config: Config | null; error: string | null }>(() => {
    try {
      return { config: JSON.parse(text) as Config, error: null };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const setField = (path: string[], value: string) => {
    if (!parsed.config) return;
    const next = structuredClone(parsed.config);
    let node = next as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      node[key] = (node[key] && typeof node[key] === "object" ? node[key] : {}) as Record<string, unknown>;
      node = node[key] as Record<string, unknown>;
    }
    const last = path.at(-1)!;
    if (value.trim()) node[last] = value;
    else delete node[last];
    setText(JSON.stringify(next, null, 2));
  };

  const validate = useMutation({
    mutationFn: () => api<{ valid: boolean; errors: string[] }>("/validate", { method: "POST", json: { config: parsed.config } }),
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ versionId: string; number: number }>(`/sites/${siteId}/versions`, {
        method: "POST",
        json: { config: parsed.config, note: note || null, createdBy: "operator" },
      }),
    onSuccess: async ({ number }) => {
      toast(`v${number} 초안을 저장했습니다`);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      await queryClient.invalidateQueries({ queryKey: ["latest", siteId] });
    },
  });
  const site = queryClient.getQueryData<{ versions: VersionRow[] }>(["site", siteId]);
  const latestPreview = site?.versions[0]?.preview_url;

  if (latest.error) return <ErrorAlert error={latest.error} />;
  return (
    <Stack spacing={2}>
      {GROUPS.map((group) => (
        <Paper key={group.title} sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
            {group.title}
          </Typography>
          <Grid container spacing={2}>
            {group.fields.map((f) => (
              <Grid key={f.path.join(".")} size={{ xs: 12, sm: f.half ? 6 : 12 }}>
                <TextField
                  fullWidth
                  size="small"
                  label={f.label}
                  multiline={f.multiline}
                  minRows={f.multiline ? 2 : undefined}
                  value={String(getIn(parsed.config, f.path) ?? "")}
                  onChange={(e) => setField(f.path, e.target.value)}
                  disabled={!parsed.config || save.isPending}
                  // Values arrive from the JSON after mount; keep labels above them.
                  slotProps={{ htmlInput: { name: f.path.join(".") }, inputLabel: { shrink: true } }}
                />
              </Grid>
            ))}
          </Grid>
        </Paper>
      ))}
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            전체 설정 (JSON) {latest.data ? `· 최신 v${latest.data.version.number} 기준` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            나머지 섹션·사진·FAQ는 여기서 고칩니다(큰 수정은 AI 도구로)
          </Typography>
        </Stack>
        <CodeMirror
          value={text}
          height="420px"
          extensions={[json()]}
          onChange={setText}
          readOnly={save.isPending}
          data-testid="json-editor"
        />
        {parsed.error ? <Alert severity="warning">JSON 문법 오류: {parsed.error}</Alert> : null}
      </Paper>
      {validate.data ? (
        validate.data.valid ? (
          <Alert severity="success" data-testid="validate-ok">
            검증 통과
          </Alert>
        ) : (
          <Alert severity="error" sx={{ whiteSpace: "pre-line" }} data-testid="validate-errors">
            {validate.data.errors.join("\n")}
          </Alert>
        )
      ) : null}
      <ErrorAlert error={validate.error ?? save.error} />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <TextField size="small" label="변경 메모" value={note} onChange={(e) => setNote(e.target.value)} sx={{ flex: 1 }} />
        <Button onClick={() => validate.mutate()} disabled={!parsed.config || validate.isPending}>
          검증
        </Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={!parsed.config || save.isPending}>
          초안으로 저장
        </Button>
        {latestPreview ? (
          <Button href={latestPreview} target="_blank" title="운영자 검수용 버전 미리보기입니다. 사장님께는 개요의 시안 링크를 보내세요">
            내부 미리보기
          </Button>
        ) : null}
      </Stack>
    </Stack>
  );
}

import { Button, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.js";
import { ErrorAlert } from "../ui.js";

/** Starts a site from the template's starter config; copy and photos are filled afterwards. */
export function NewSitePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ preset: "lesson", slug: "", name: "", phone: "", representative: "" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const create = useMutation({
    mutationFn: () => api<{ siteId: string }>("/sites", { method: "POST", json: { starter: form, createdBy: "operator" } }),
    onSuccess: async ({ siteId }) => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      navigate(`/sites/${siteId}/edit`);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Paper component="form" onSubmit={submit} sx={{ p: 3, maxWidth: 560 }}>
      <Stack spacing={2}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          새 사이트
        </Typography>
        <Typography color="text.secondary" variant="body2">
          기본 정보로 시작 설정을 만듭니다. 문구와 사진은 다음 화면에서 채우거나 AI(MCP)로 작성합니다.
        </Typography>
        <TextField select label="업종 템플릿" value={form.preset} onChange={set("preset")} slotProps={{ htmlInput: { "data-testid": "preset" } }}>
          <MenuItem value="lesson">레슨·교육</MenuItem>
          <MenuItem value="field">출장 서비스</MenuItem>
        </TextField>
        <TextField
          label="slug (주소)"
          value={form.slug}
          onChange={set("slug")}
          required
          helperText="영문 소문자·숫자·하이픈. <slug>.dsites.kr"
          slotProps={{ htmlInput: { name: "slug" } }}
        />
        <TextField label="상호" value={form.name} onChange={set("name")} required slotProps={{ htmlInput: { name: "name" } }} />
        <TextField label="전화번호" value={form.phone} onChange={set("phone")} required slotProps={{ htmlInput: { name: "phone" } }} />
        <TextField label="대표자" value={form.representative} onChange={set("representative")} slotProps={{ htmlInput: { name: "representative" } }} />
        <ErrorAlert error={create.error} />
        <Button type="submit" variant="contained" disabled={create.isPending}>
          만들기
        </Button>
      </Stack>
    </Paper>
  );
}

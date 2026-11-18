import { Alert, Box, Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, kst, type DomainRow } from "../../api.js";
import { ErrorAlert, StatusChip, useToast } from "../../ui.js";

export function DomainsTab({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [hostname, setHostname] = useState("");
  const domains = useQuery({ queryKey: ["domains", siteId], queryFn: () => api<{ domains: DomainRow[] }>(`/sites/${siteId}/domains`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["domains", siteId] });
  const add = useMutation({
    mutationFn: () => api(`/sites/${siteId}/domains`, { method: "POST", json: { hostname } }),
    onSuccess: async () => {
      setHostname("");
      toast("도메인을 등록했습니다. 아래 DNS 안내를 고객에게 전달하세요");
      await refresh();
    },
  });
  const act = useMutation({
    mutationFn: ({ host, remove }: { host: string; remove?: boolean }) =>
      remove
        ? api(`/sites/${siteId}/domains/${encodeURIComponent(host)}`, { method: "DELETE" })
        : api(`/sites/${siteId}/domains/${encodeURIComponent(host)}/refresh`, { method: "POST", json: {} }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
  const custom = (domains.data?.domains ?? []).filter((d) => d.kind === "custom");
  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            size="small"
            label="고객 도메인 (예: www.example.co.kr)"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { name: "hostname" } }}
          />
          <Button variant="contained" onClick={() => add.mutate()} disabled={!hostname || add.isPending}>
            연결
          </Button>
        </Stack>
      </Paper>
      <ErrorAlert error={domains.error ?? add.error ?? act.error} />
      {custom.map((d) => (
        <Paper key={d.hostname} sx={{ p: 2 }} data-testid={`domain-${d.hostname}`}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography sx={{ fontWeight: 700, flex: 1 }}>
              {d.hostname}
            </Typography>
            <StatusChip status={d.status} />
            <Button size="small" onClick={() => act.mutate({ host: d.hostname })}>
              상태 확인
            </Button>
            <Button size="small" color="error" onClick={() => act.mutate({ host: d.hostname, remove: true })}>
              삭제
            </Button>
          </Stack>
          {d.verification_records ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>유형</TableCell>
                  <TableCell>이름</TableCell>
                  <TableCell>값</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>{d.verification_records.cname.type}</TableCell>
                  <TableCell>{d.verification_records.cname.name}</TableCell>
                  <TableCell>{d.verification_records.cname.value}</TableCell>
                </TableRow>
                {d.verification_records.optionalTxt ? (
                  <TableRow>
                    <TableCell>TXT (선택)</TableCell>
                    <TableCell>{d.verification_records.optionalTxt.name}</TableCell>
                    <TableCell sx={{ wordBreak: "break-all" }}>{d.verification_records.optionalTxt.value}</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          ) : null}
          {d.verification_records?.note ? <Alert severity="info" sx={{ mt: 1 }}>{d.verification_records.note}</Alert> : null}
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              마지막 확인 {kst(d.checked_at)} {d.last_error ? `· ${d.last_error}` : ""}
            </Typography>
          </Box>
        </Paper>
      ))}
      {!custom.length && !domains.isLoading ? (
        <Typography color="text.secondary">연결된 커스텀 도메인이 없습니다. 기본 주소로 운영 중입니다.</Typography>
      ) : null}
    </Stack>
  );
}

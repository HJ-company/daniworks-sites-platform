import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, kst, type DomainRow } from "../../api.js";
import { ErrorAlert, StatusChip, useToast } from "../../ui.js";
import { CopyableMessage, useCopy } from "../../copy-message.js";
import { customerGuide, domainErrorText, hostLabel } from "./domain-guide.js";

function CopyButton({ text, label }: { text: string; label: string }) {
  const copy = useCopy();
  return (
    <Tooltip title={`${label} 복사`}>
      <IconButton size="small" aria-label={`${label} 복사`} onClick={() => copy(text, `${label}을(를) 복사했습니다`)}>
        <ContentCopyIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}

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
      toast("도메인을 등록했습니다. 아래 안내문을 사장님께 보내세요");
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
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          www가 붙은 주소로 연결하는 것이 기본입니다. www 없는 주소는 등록업체의 도메인 포워딩으로 www 주소에 보냅니다.
        </Typography>
      </Paper>
      <ErrorAlert error={domains.error ?? add.error ?? act.error} />
      {custom.map((d) => {
        const records = d.verification_records;
        const error = domainErrorText(d.last_error);
        return (
          <Paper key={d.hostname} sx={{ p: 2 }} data-testid={`domain-${d.hostname}`}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1, flexWrap: "wrap" }}>
              <Typography sx={{ fontWeight: 700, flex: 1 }}>{d.hostname}</Typography>
              <StatusChip status={d.status} />
              <Button size="small" onClick={() => act.mutate({ host: d.hostname })}>
                상태 확인
              </Button>
              <Button size="small" color="error" onClick={() => act.mutate({ host: d.hostname, remove: true })}>
                삭제
              </Button>
            </Stack>
            {records && d.status !== "active" ? (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>유형</TableCell>
                      <TableCell>이름(호스트)</TableCell>
                      <TableCell>값</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell>{records.cname.type}</TableCell>
                      <TableCell>
                        <b>{hostLabel(d)}</b>
                        <CopyButton text={hostLabel(d)} label="이름" />
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          전체 주소를 요구하는 업체는 {records.cname.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <b>{records.cname.value}</b>
                        <CopyButton text={records.cname.value} label="값" />
                      </TableCell>
                    </TableRow>
                    {records.optionalTxt ? (
                      <TableRow>
                        <TableCell>TXT (선택)</TableCell>
                        <TableCell sx={{ wordBreak: "break-all" }}>{records.optionalTxt.name}</TableCell>
                        <TableCell sx={{ wordBreak: "break-all" }}>
                          {records.optionalTxt.value}
                          <CopyButton text={records.optionalTxt.value} label="TXT 값" />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
                <Alert severity="info" sx={{ mt: 1 }}>
                  고객이 추가할 것은 CNAME 1개입니다. 반영까지 보통 몇 분, 길면 하루가 걸리며 설정 뒤 "상태 확인"을 누르면 됩니다.
                  {records.optionalTxt ? " TXT는 이 도메인으로 다른 홈페이지를 운영 중이라 끊김 없이 옮겨야 할 때만 추가합니다." : ""}
                </Alert>
                {records.note ? <Alert severity="warning" sx={{ mt: 1 }}>{records.note}</Alert> : null}
                <CopyableMessage text={customerGuide(d)} copyLabel="사장님께 보낼 안내문 복사" copied="사장님께 보낼 안내문을 복사했습니다" />
              </>
            ) : null}
            {error && d.status !== "active" ? (
              <Alert severity="warning" sx={{ mt: 1 }} data-testid="domain-error">
                {error}
              </Alert>
            ) : null}
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                마지막 확인 {kst(d.checked_at)}
              </Typography>
            </Box>
          </Paper>
        );
      })}
      {!custom.length && !domains.isLoading ? (
        <Typography color="text.secondary">연결된 커스텀 도메인이 없습니다. 기본 주소로 운영 중입니다.</Typography>
      ) : null}
    </Stack>
  );
}

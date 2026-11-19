import { Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, kst } from "../../api.js";

interface Entry {
  actor_type: "user" | "script";
  actor_name: string | null;
  via: "console" | "mcp" | "script";
  action: string;
  target: string | null;
  status: number;
  created_at: string;
}

const ACTIONS: [RegExp, string][] = [
  [/\/publish$/, "게시"],
  [/\/rollback$/, "롤백"],
  [/\/suspend$/, "공개 정지"],
  [/\/resume$/, "공개 재개"],
  [/^POST \/sites\/:id\/payments$/, "입금 확인"],
  [/^PATCH \/sites\/:id\/subscription$/, "구독 조건 변경"],
  [/\/subscription\/bill$/, "청구"],
  [/^POST \/sites\/:id\/draft-link$/, "시안 링크 발급"],
  [/^DELETE \/sites\/:id\/draft-link$/, "시안 링크 막기"],
  [/\/cancel$/, "해지"],
  [/\/reactivate$/, "해지 취소"],
  [/^POST \/sites\/:id\/versions$/, "초안 저장"],
  [/^POST \/sites\/:id\/domains$/, "도메인 연결"],
  [/^DELETE \/sites\/:id\/domains/, "도메인 삭제"],
  [/^POST \/sites\/:id\/assets$/, "사진 올림"],
  [/^DELETE \/sites\/:id\/assets\//, "사진 지움"],
  [/^PATCH \/sites\/:id$/, "사이트 설정 변경"],
  [/^POST \/sites$/, "사이트 생성"],
  [/^PATCH \/payments\/:id$/, "결제 기록 수정"],
  [/^POST \/payments\/:id\/void$/, "결제 취소"],
];

const TOOLS: Record<string, string> = {
  site_create: "사이트 생성",
  site_update_draft: "초안 저장",
  site_publish: "게시",
  site_rollback: "롤백",
  site_preview_link: "시안 링크",
  asset_upload: "사진 올림",
  asset_delete: "사진 지움",
  image_generate: "AI 이미지 만듦",
};

/** Audit action (`POST /sites/:id/publish`, `MCP site_publish`) in words. */
export function actionLabel(action: string, target: string | null = null) {
  const replaced = target === "replaced" && (action === "POST /sites/:id/draft-link" || action === "MCP site_preview_link");
  if (replaced) return `${action.startsWith("MCP") ? "AI 도구: " : ""}시안 링크 새로 바꿈(예전 링크 막힘)`;
  const tool = /^MCP (.+)$/.exec(action)?.[1];
  const label = tool ? `AI 도구: ${TOOLS[tool] ?? tool}` : (ACTIONS.find(([pattern]) => pattern.test(action))?.[1] ?? action);
  return `${label}${detailOf(target)}`;
}

const PURPOSE: Record<string, string> = { background: "배경", illustration: "일러스트", mood: "분위기", work: "작업물·고객 요청" };

/** The extra the audit keeps for some actions: an AI image's purpose, the photo removed. */
function detailOf(target: string | null) {
  if (!target) return "";
  const purpose = /^purpose=(\w+)$/.exec(target)?.[1];
  if (purpose) return ` (${PURPOSE[purpose] ?? purpose})`;
  const key = /^key=m:[^/]+\/([a-f0-9]+)\.jpg$/.exec(target)?.[1];
  if (key) return ` (사진 ${key.slice(0, 8)}…)`;
  return "";
}

const who = (e: Entry) => (e.actor_type === "script" ? "스크립트" : `${e.actor_name ?? "운영자"}${e.via === "mcp" ? " (AI 도구)" : ""}`);

/** Recent changes to the site (latest 50) and who made them: console, AI tools, scripts. */
export function ActivityCard({ siteId }: { siteId: string }) {
  const log = useQuery({ queryKey: ["audit", siteId], queryFn: () => api<{ entries: Entry[] }>(`/sites/${siteId}/audit`) });
  const entries = log.data?.entries ?? [];
  return (
    <Paper data-testid="activity-card">
      <Typography variant="subtitle1" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
        작업 기록
      </Typography>
      {entries.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>때(KST)</TableCell>
              <TableCell>누가</TableCell>
              <TableCell>무엇을</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={`${e.created_at}-${i}`}>
                <TableCell>{kst(e.created_at)}</TableCell>
                <TableCell>{who(e)}</TableCell>
                <TableCell>
                  {actionLabel(e.action, e.target)}
                  {e.status >= 400 ? (
                    <Typography component="span" variant="caption" color="error">
                      {" "}
                      (거부됨)
                    </Typography>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          아직 기록이 없습니다.
        </Typography>
      )}
    </Paper>
  );
}

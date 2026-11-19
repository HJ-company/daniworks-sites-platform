import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Alert, Box, Button, Link, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router";
import { useMe } from "../api.js";
import { useToast } from "../ui.js";

const FIRST_REQUEST = `아래 리드로 스타터 홈페이지 시안을 만들어 줘. 게시는 하지 말고 시안 링크까지만.
사이트 영문 주소는 (예: green-tennis)로 해 줘.

(노션 리드 페이지 내용, 블로그·플레이스 주소, 받은 사진을 붙여 넣기)`;

/** How operators connect Claude or ChatGPT to the platform's tools, in plain words. */
export function AiToolsPage() {
  const toast = useToast();
  const me = useMe();
  const url = me.data?.mcpUrl ?? null;
  const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast(done));
  return (
    <Stack spacing={2} sx={{ maxWidth: 820 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        AI 도구 연결 방법
      </Typography>
      <Typography variant="body2" color="text.secondary">
        홈페이지는 Claude나 ChatGPT에 우리 제작 도구를 연결해 대화로 만듭니다. 한 번 연결하면 AI가 제작 지침을 읽고 고객 등록, 시안 작성, 시안 링크
        발급까지 합니다. 운영자는 이 콘솔에서 검수·입금 확인·게시합니다. (기술 용어로는 이 연결을 MCP라고 합니다.)
      </Typography>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          연결 주소
        </Typography>
        {url ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
            <Box component="code" sx={{ bgcolor: "grey.100", px: 1, py: 0.5, borderRadius: 1 }} data-testid="mcp-url">
              {url}
            </Box>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(url, "연결 주소를 복사했습니다")}>
              복사
            </Button>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            연결 주소가 설정되지 않았습니다. 관리자에게 문의하세요.
          </Typography>
        )}
        <Typography variant="body2" sx={{ mt: 1 }}>
          로그인은 콘솔과 같은 회사 계정(Authentik)으로 합니다. 운영자 권한이 있어야 쓸 수 있고, AI가 한 일은 내 이름으로 작업 기록에 남습니다.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Claude에 연결
        </Typography>
        <Box component="ol" sx={{ my: 1, pl: 3, "& li": { mb: 0.5 } }}>
          <li>Claude 설정의 커넥터(Connectors)에서 사용자 지정 커넥터를 추가합니다.</li>
          <li>이름은 "스타터 홈페이지", 주소는 위의 연결 주소를 붙여 넣습니다.</li>
          <li>연결을 누르면 회사 계정 로그인 창이 뜹니다. 로그인하면 끝입니다.</li>
          <li>대화를 시작할 때 이 커넥터가 켜져 있는지 확인합니다.</li>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          ChatGPT에 연결
        </Typography>
        <Box component="ol" sx={{ my: 1, pl: 3, "& li": { mb: 0.5 } }}>
          <li>ChatGPT 설정에서 커넥터(앱)를 추가합니다. 사용자 지정 커넥터는 개발자 모드가 필요할 수 있습니다.</li>
          <li>주소에 연결 주소를 넣고, 인증 방식은 OAuth를 고릅니다.</li>
          <li>회사 계정으로 로그인합니다.</li>
        </Box>
        <Alert severity="info">ChatGPT 연결은 실제 서버에서 아직 확인 전입니다. 막히면 Claude를 쓰세요.</Alert>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          첫 요청 예시
        </Typography>
        <Box component="pre" sx={{ bgcolor: "grey.100", p: 1.5, borderRadius: 1, whiteSpace: "pre-wrap", fontSize: 14 }}>
          {FIRST_REQUEST}
        </Box>
        <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(FIRST_REQUEST, "예시를 복사했습니다")}>
          예시 복사
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          AI가 따르는 규칙은{" "}
          <Link component={RouterLink} to="/guides">
            제작 지침
          </Link>
          에 있습니다. 결과는 사이트 목록에 바로 나타나고, 시안 링크는 사이트 개요에서 다시 확인할 수 있습니다.
        </Typography>
      </Paper>
    </Stack>
  );
}

# 2-7 MCP 도구 codex review

명령: `codex review --uncommitted`, 2회.

| 회차 | 등급 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | P1 | `site_preview_url`·`site_publish`·`site_rollback`이 등록되지 않음 | **기각(오탐)**: `apps/api/src/mcp.ts`에 10개 `registerTool`이 모두 있고, Docker 검증에서 실제 MCP 클라이언트가 10종을 받아 게시·롤백까지 호출했다(19/19). 2회차 리뷰도 지적 없음 |
| 2 | - | 지적 없음 | - |

## 검증 (Docker)

- `verify-m2-mcp.mjs` 19/19: MCP SDK v2 클라이언트(Streamable HTTP)로 인증 401, 도구 10종, 지침·뼈대, 검증 오류 경로, 생성, 업로드(base64·네이버 썸네일 URL→900px), 초안, slug 변경 거부, 조회(slug), 프리뷰, 게시, 롤백
- 회귀: M1 18/18, 템플릿 28/28, 업로드 26/26, 문의 24/24, 측정 8/8

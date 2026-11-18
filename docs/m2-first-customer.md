---
type: result
status: current
date: 2026-11-19
milestone: M2
---

# M2 첫 고객 결과 (로컬)

결론: 첫 고객을 여는 데 필요한 기능을 모두 만들었고, Docker 로컬 환경에서 검증 187건이 통과했다. 범위는 업종 템플릿 1번, 사진, 문의, 측정, MCP, 커스텀 도메인, 운영자 콘솔이다. AI 에이전트는 블로그 RSS만으로 약 3분, 약 $1에 검증을 통과한 시안을 만들었다. 남은 일은 스테이징 배포와 실제 리드 1곳 오픈이다. 이때 Cloudflare 계정 설정(for SaaS, Email, Turnstile, Access)이 필요하다.

## 만든 것

| 영역 | 내용 | 위치 |
| --- | --- | --- |
| 설정 v2 | 업종 템플릿 + 구조화 콘텐츠(zod). 블록·variant는 템플릿이 정한다 | `packages/schema`, `packages/renderer/src/templates/service-local` |
| 업종 템플릿 | `service-local`(레슨·교육 / 출장), 원페이지 + 개인정보처리방침, 하단 연락 바, JSON-LD(업체·FAQ), OG, canonical, 반응형 WebP, LCP 이미지 preload | 같은 곳 |
| 사진 | 업로드·URL 가져오기, EXIF 방향, 긴 변 1600px, WebP 변형 3종, 3MP 한도(Worker 메모리 실측), 네이버 썸네일 원본 크기 | `apps/api/src/media.ts`, `assets.ts` |
| 라우팅 | 호스트 KV 1회 조회, cacheTtl 30초, 정지 503·해지 410, D1 기준 동기화(lease, 재시도, 5분 재조정, 매시간 점검), 불변 렌더(render_id) | `apps/api/src/routes.ts`, `apps/router` |
| 문의 | 라우터 → api RPC, 허니팟·시간·Turnstile(플랫폼 프레임)·방문자/사이트 한도(원자적), 사장님 메일, 목록·CSV | `apps/api/src/inquiries.ts` |
| 측정 | 방문·클릭 비콘 → D1 일별 집계, 봇·프리뷰 제외, 리포트 API | `apps/api/src/metrics.ts`, `packages/renderer/src/platform/track.ts` |
| MCP | 도구 10종(stateless Streamable HTTP), 자리표시자 뼈대 | `apps/api/src/mcp.ts` |
| 커스텀 도메인 | Cloudflare for SaaS(HTTP DCV, CNAME 1줄), 활성화 시 대표 호스트 전환·301·재렌더, 장애·경합에 강한 수명주기 | `apps/api/src/domains.ts`, `saas.ts` |
| 운영자 콘솔 | Vite React CSR + MUI. 목록·생성·편집·검증·게시·롤백·사진·도메인·문의·통계·정지 | `apps/console` |
| 로컬 검증 | Docker(workers, mailpit, cf-mock, verify), `verify-all` | `docker-compose.yml`, `scripts/` |

## 결과

| 검증 | 결과 |
| --- | --- |
| `docker compose run --rm verify node scripts/verify-all.mjs` | 187/187 (9개 스크립트, 깨끗한 상태에서) |
| 단위 테스트 | api 70, renderer 31, schema 22, console 5 |
| Lighthouse 모바일(로컬 시뮬레이션, 3회 중앙값) | 성능 99~100, 접근성 100, SEO 92, LCP 1.2~2.1초 |
| codex review | 단계마다 지적이 없어질 때까지 반복(단계별 기록: `evidence/m2-*/codex-review.md`) |
| AI 시안 실측 | 3분 17초, 11턴, $1.02 (`evidence/m2-mcp/agent-run.md`) |

## 계획과 달라진 것

- **Turnstile**: 위젯의 허용 호스트 수 제한 때문에 고객 도메인마다 위젯을 둘 수 없다. api 호스트의 프레임에서 위젯을 띄우고 토큰을 postMessage로 받는다. 프레임이 실제로 프레임 호스트 기준으로 검증되는지는 스테이징에서 확인해야 한다.
- **사진 한도**: Photon 디코딩은 1MP당 약 18MiB를 쓴다. 12MP 휴대폰 원본은 128MB isolate를 넘으므로, Worker는 3MP까지만 받고 콘솔이 브라우저에서 줄여 올린다.
- **롤백**: 도메인이 바뀐 뒤 예전 버전으로 롤백하면 그 버전만 다시 렌더한다(canonical이 현재 도메인을 가리키도록). 같은 origin이면 포인터만 옮긴다.
- **렌더 불변화**: 렌더마다 `render_id` 경로에 쓰고 포인터가 그것을 가리킨다. 동시 렌더가 페이지를 섞지 않는다. M1 경로는 계속 서빙된다.
- **예시 데이터**: MCP `template_get`이 실제 업체 fixture를 주면 에이전트가 문구를 베꼈다. 자리표시자 뼈대로 바꿨다.

## 스테이징·오픈 전에 필요한 것 (사용자·Cloudflare 작업)

| 항목 | 필요한 것 |
| --- | --- |
| 커스텀 도메인 | dsites.kr 존의 Cloudflare for SaaS 활성화, fallback origin(`fallback.dsites.kr`), API 토큰(SSL and Certificates Edit), `CF_ZONE_ID`·`CF_API_TOKEN` 시크릿 |
| 메일 | `wrangler email sending enable dsites.kr`, SPF·DKIM |
| Turnstile | api.dsites.kr을 허용 호스트로 한 위젯, 사이트 키·시크릿 |
| 운영자 콘솔 | admin.dsites.kr Access 애플리케이션(팀 도메인, AUD), 콘솔 `ADMIN_TOKEN` |
| 마이그레이션 | 스테이징 D1에 0002~0004 적용 |
| 실측 | KV 반영 시간(cacheTtl 30초), 국내 회선 Lighthouse, 등록업체 CNAME, 3MP 업로드 메모리 |

## 확인하지 않은 것

- 실제 Cloudflare 서비스(for SaaS 인증서 발급, Email 전달, Turnstile 실키, Access JWT): 모두 대체물(cf-mock, Mailpit, 테스트 키)로만 확인했다.
- 운영 Worker의 메모리·CPU 한도: 로컬 workerd에는 적용되지 않는다.
- 비콘을 반복해 보내 수치를 부풀리는 것은 막지 않는다(분기 리포트 용도로 허용).

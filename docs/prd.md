---
type: prd
status: draft
date: 2026-11-19
product: 스타터 홈페이지
policy: https://app.notion.com/p/41cecd5a3ac28107820effaeb6cb4fc8
---

# 스타터 홈페이지 플랫폼 PRD

상품 정책(가격·제공 범위·계약·판매 기준)은 노션 정책서가 기준이다. 이 문서는
그 정책을 만족시키는 플랫폼의 요구사항과 기술 구조를 다룬다. 둘이 어긋나면
정책서를 따르고 이 문서를 고친다. 운영자 화면·과금·MCP 도구의 세부는
[관리자 콘솔](admin-console.md)을 따른다.

## 1. 배경

- 상품: 블로그·네이버 플레이스·인스타 정보로 원페이지 홈페이지를 만들고, 월 구독(공급가 3만원)으로 호스팅·수정·AI 노출 재측정을 맡는다.
- 대상: 자체 홈페이지가 없거나 방치된 지역 사업자. 우선 영업은 출장·시공·1인 B2B.
- 원가 구조: 매출 대비 인프라 원가는 작고, 인건비(구축·수정·재측정)가 대부분이다. 출시 전제는 **구축 3시간 이하**.
- 그래서 플랫폼의 목적은 사이트 수가 늘어도 사람 손이 늘지 않게 하는 것이다.

## 2. 목표와 비목표

### 목표

1. AI가 고객 자료로 사이트 설정(JSON) 초안을 만들고, 사람은 검수·게시만 한다.
2. 사이트 수백 곳을 Worker 하나, DB 하나로 운영한다. 사이트 추가는 DB 행 추가다.
3. 게시는 수 초 안에 끝나고, 언제든 이전 버전으로 되돌릴 수 있다.
4. 고객이 콘솔에서 커스텀 도메인을 직접 연결한다.
5. 분기 리포트에 넣을 방문 수와 전화·카톡·지도 클릭 수를 수집한다.

### 비목표

- 고객용 콘텐츠 편집 화면(CMS). 관리 화면은 AI 홈페이지 상품의 영역이다.
- 2페이지 이상, 제품 목록·상세, 예약·결제·회원 기능.
- AI 상담, AI 커넥터, 월간 리포트 등 AI 홈페이지 기능.
- control plane과의 통합. 대상 고객이 달라 별도로 운영한다.

## 3. 사용자와 주요 흐름

| 사용자 | 하는 일 | 접점 |
| --- | --- | --- |
| 운영자(다니웍스) | 사이트 제작, 시안 검수, 게시, 입금 확인, 도메인 문제 대응 | Claude/ChatGPT + MCP 도구, [관리자 콘솔](admin-console.md) |
| AI 에이전트 | 자료 수집 결과로 설정 초안 작성, 수정 요청 반영 | MCP 도구(플랫폼 API) |
| 고객(사장님) | 시안 확인, 도메인 연결, 문의 확인, 리포트 열람, 수정 요청 | 시안 링크, 고객 콘솔(보류) |
| 방문자 | 사이트 열람, 전화·카톡·지도·문의 | 공개 사이트 |

### 제작 흐름

리드는 외부(노션 등)에서 관리한다. 세부 흐름과 콘솔 화면은 [관리자 콘솔](admin-console.md)을 따른다.

1. 수집: 자가진단 리드 데이터 + geo-prove 결과 + 블로그·플레이스·인스타 URL
2. 초안: 운영자가 Claude/ChatGPT에서 MCP 도구로 고객·사이트를 만들고 설정을 `draft` 버전으로 저장
3. 검수: 스키마 검증 통과 후 운영자가 프리뷰 URL에서 확인·수정
4. 시안: 사이트 시안 링크를 카톡으로 발송
5. 오픈: 입금 확인 후 게시. `<slug>.dsites.kr`로 즉시 공개. 결제 전 게시는 예외 없이 막는다
6. 도메인: 커스텀 도메인 등록 → DNS 안내 → 연결 확인 (지금은 운영자가 콘솔에서, 이후 고객 콘솔에서)
7. 운영: 카톡 수정 요청을 AI가 `draft`로 반영 → 운영자 검수 → 게시

## 4. 기능 요구사항

### 4-1. 사이트 설정

- 형식: `@dani-builder/site-templates`의 `TemplateSeed` + 플랫폼 메타(연락처, 업종, 도메인, RSS URL 등).
- 저장 전 `collectSeedValidationErrors`와 플랫폼 스키마로 검증한다. 검증 실패는 저장하지 않는다.
- 업종 템플릿: 업종별 원페이지 구조(섹션 순서, 전화·카톡·지도 CTA 배치, 필수 정보, AI 작성 지침)다. 블록 디자인(빌더 소유)과 별개로 이 플랫폼이 소유한다. 빌더 ADR 0008이 블록 배치·카피를 소비자 소유로 정했다. 필요한 블록이나 계약이 빌더에 없을 때만 빌더에 요청한다.
- 1번 템플릿: 레슨·교육·출장 서비스(공사·하수도·청소 등). 실제 리드(지역 레슨 아카데미)를 기준으로 만든다.
- 나머지 템플릿은 가설이다. 운영 자가진단 리드의 업종 분포를 보고 정한다. 초기 가설은 음식점, 뷰티·서비스, 1인·소규모 B2B였다.
- 사진은 R2에 업로드하고 설정에는 키만 저장한다. Worker는 3MP 이하만 받는다(디코딩 메모리 실측 1MP당 약 18MiB). 콘솔이 브라우저에서 긴 변 1600px로 줄여 올린다.
- AI 생성 이미지는 배경·일러스트에만 쓰고 실제 작업물 사진은 고객 사진만 쓴다. 고객이 요청하면 예외로 생성하고 요청 기록을 남긴다.

### 4-2. 버전과 게시

- 모든 저장은 `site_versions`에 새 행으로 쌓는다(append-only).
- 상태: `draft` → `published`. 게시된 버전은 사이트당 하나다.
- 게시 = 검증 → HTML 렌더 → R2 `sites/<siteId>/<versionId>/` 업로드 → KV 포인터 교체.
- 게시는 사이트 구독이 활성일 때만 가능하다. API가 검사하므로 콘솔·MCP 모두 같은 규칙을 따른다.
- 롤백 = KV 포인터를 이전 버전으로 교체. 재렌더하지 않는다. 단, 커스텀 도메인 연결·해제로 대표 주소가 바뀐 뒤면 그 버전만 다시 렌더한다(canonical·OG).
- 렌더는 불변이다. 렌더마다 `sites/<id>/<ver>/r/<renderId>/`에 쓰고 포인터가 renderId를 가리킨다.
- KV는 최종적 일관성이라 게시·롤백이 전 세계에 반영되기까지 최대 1분 정도 걸린다. 스테이징 실측 최대 60.2초(`cacheTtl` 60초 기준, [스테이징 결과](staging-deploy.md)). 이후 `cacheTtl`을 30초로 낮췄고 재측정이 남았다. 프리뷰 URL은 KV를 거치지 않고 버전을 직접 읽어, 운영자는 게시 직후 결과를 확인할 수 있다.
- 버전 프리뷰(내부 검수용): 버전마다 토큰을 두고 `api.dsites.kr/preview/<token>`으로 본다. 검색엔진 차단.
- 시안 링크(고객 발송용): `dsites.kr/preview/{token}`. 사이트 단위 토큰으로 항상 최신 draft를 보여준다. 유효기간 30일. 상단 시안 배너, 문의 전송 차단, 클릭 수집 끔, `noindex`. 세부는 [관리자 콘솔 3절](admin-console.md#시안-링크).

### 4-3. 렌더링

- 템플릿 버전마다 한 번: CSS와 클라이언트 JS 번들(슬라이더·FAQ·문의 폼 등 인터랙션)을 빌드해 R2 공용 경로에 둔다.
- 게시마다: `@dani-builder/blocks`로 `renderToString`해 HTML 한 장을 만든다. 빌드 서버 없이 Worker에서 실행한다.
- 출력에 포함: 구조화 데이터(업체·영업시간·서비스·지역), 메타·OG, 사이트맵, robots, 개인정보처리방침 페이지.
- 템플릿 업데이트 시 전체 사이트를 재게시하는 운영 명령을 둔다(`scripts/republish-all.mjs`). 새 렌더를 공개 화면과 픽셀 비교해 같을 때만 적용하고, 달라진 사이트는 차이 이미지와 함께 보류한다. 재게시 대상은 렌더 버전(`RENDER_VERSION`)으로 판정한다.

### 4-4. 라우팅·도메인

- 기본 도메인: `*.dsites.kr` 와일드카드. slug는 사이트 생성 시 확정. 1단계 와일드카드라 Universal SSL로 덮인다.
- 커스텀 도메인: Cloudflare for SaaS 커스텀 호스트네임. HTTP DCV라 고객은 CNAME 한 줄(`www` → fallback origin)만 추가한다. TXT는 다른 곳에서 운영 중인 도메인을 옮길 때만 쓴다. 활성화되면 대표 주소가 되고 기본 도메인은 301로 보낸다.
- 루트 도메인(example.com)은 국내 등록업체 대부분이 CNAME/ALIAS를 지원하지 않는 것으로 보인다. 고정 IP로 연결하는 Apex Proxying은 Enterprise 전용이다. 안내 기본값은 `www` CNAME 연결 + 등록업체 루트 포워딩(`customer.kr` → `https://www.customer.kr`).
- 루트 직접 연결은 고객 DNS가 ALIAS/CNAME 평탄화를 지원하거나 네임서버가 Cloudflare일 때만 허용한다. 이 경우 호스트네임을 2개(루트·www) 쓴다.
- 비용: 호스트네임 100개 포함, 이후 개당 월 $0.10. 해지 시 호스트네임을 즉시 삭제하고, quota API로 사용량을 점검한다.
- 라우터 Worker: Host → 호스트 키 1회 조회(KV, 게시 포인터 포함) → R2 객체. `dsites.kr` 존의 `*/*` 라우트를 라우터가 잡는다. 한 존에서 `*/*`는 Worker 하나만 가질 수 있어 이 존에는 다른 서비스를 두지 않는다.
- 주소 정리:

| 주소 | 용도 |
| --- | --- |
| `<slug>.dsites.kr` | 공개 사이트 기본 주소 |
| `dsites.kr/preview/{token}` | 고객용 시안 링크 |
| `api.dsites.kr` | 플랫폼 API, MCP(`/mcp`), 버전 프리뷰, Turnstile 프레임 |
| fallback origin(`*.dsites.kr` 하위) | 커스텀 도메인 CNAME 대상 |
| `dsites-console.daniworks.kr` | 관리자 콘솔 |
| `authentik.daniworks.kr` | 운영자 로그인(OIDC·OAuth) |

### 4-5. 문의

- 공용 엔드포인트 `POST /api/inquiry`. Host로 사이트를 판별해 D1에 저장한다.
- 스팸: 허니팟, 작성 시간, Turnstile, 방문자·사이트별 한도. Turnstile 위젯은 허용 호스트 수가 제한되어 api 호스트의 프레임에서 띄우고 토큰을 postMessage로 받는다.
- 고객에게 메일 알림(기본). 알림톡은 유료 옵션으로 후순위.
- 라우터는 Host로 사이트를 판별한 뒤 api의 RPC(`PublicApi`)로 넘긴다. HTTP로는 닿지 않는다.
- 운영자 콘솔에서 문의 목록 열람·CSV 내보내기. 고객 열람은 고객 콘솔(보류)에서.

### 4-6. 측정

- 방문·클릭: 페이지 조회와 전화·카톡·지도·네이버 예약·문의 클릭을 `POST /api/track` 비콘으로 수집한다. 봇 UA와 프리뷰를 걸러내고 D1 일별 집계 테이블에 upsert한다.
- D1을 쓰는 이유: 300곳 규모의 트래픽이면 쓰기 한도 안에 들어간다. 로컬에서 끝까지 검증할 수 있고 경로가 하나다. Analytics Engine은 로컬에서 조회할 수 없다. 트래픽이 한도에 가까워지면 다시 검토한다.
- 분기 리포트: 사이트별 분기 합계·연락 전환·직전 분기 대비·월별, CSV, 전체 사이트 개요.

### 4-7. 블로그 최신 글

- 네이버 블로그 RSS를 Worker cron이 3시간마다 수집해 KV에 캐시하고, 라우터가 요청 때 홈 페이지에 최신 글 3개를 채운다. 글이 올라와도 재게시하지 않는다.
- 네이버 이미지: 외부 도메인 Referer가 붙으면 403, Referer가 없으면 200이다(2026-11-19 실측). `<img referrerpolicy="no-referrer">`로 표시하고 프록시는 두지 않는다.
- 인스타 최신 게시물: 1차 범위 제외. Graph API는 비즈니스 계정·페이스북 페이지 연결·고객별 토큰 갱신이 필요하다.

### 4-8. 관리자 콘솔

- 다니웍스 운영자 전용. Vite + React CSR + MUI. 화면과 정책은 [관리자 콘솔](admin-console.md).
- 역할: 검수, 게시·롤백, 입금 확인, 연체·해지, 도메인, 문의·통계·리포트, 전체 재게시. 사이트 제작과 콘텐츠 작성은 MCP가 맡고, 콘솔에서는 급한 오타 수정만 한다.
- 인증: Authentik OIDC(Authorization Code + PKCE). 콘솔 Worker가 세션을 들고 Authentik 액세스 토큰을 API에 넘기며, API가 JWKS로 검증해 운영자 ID를 감사 기록에 남긴다. 스크립트는 고정 토큰(`ADMIN_TOKEN`)을 쓴다.

### 4-9. 고객 콘솔 (보류)

이번 구현 범위에서 뺐다. 범위와 시점은 셀프서비스 단계에서 정한다.

- 로그인: Authentik `customer` 그룹(가입 플로우·카카오 로그인 연동은 미결).
- 기능: 사이트 상태, 커스텀 도메인 연결, 문의 목록, 분기 리포트 열람, 수정 요청 접수, 정적 파일 다운로드(게시 버전 zip).
- 콘텐츠 편집 기능은 넣지 않는다.
- 수정 요청(향후): 고객이 콘솔에서 AI 에이전트에게 말로 요청하면, 에이전트가 `draft` 버전을 만들고 프리뷰 링크를 보여준다. 사용량은 크레딧으로 제한한다.
- 상품 경계: 스타터의 AI는 고객이 사이트를 고치는 운영 도구다. AI 홈페이지의 AI는 홈페이지에 들어가 방문자가 쓰는 기능(AI 상담 등)이다. 스타터 공개 사이트에는 방문자용 AI 기능을 넣지 않는다.

### 4-10. 과금·구독

- 구독 단위는 사이트다. 고객 1명이 사이트 여러 개를 가질 수 있고, 사이트마다 정액으로 청구한다.
- 지금은 수동 입금 확인이다. 수동 확인과 PG 웹훅은 둘 다 `payments` 행을 만들고, 그 결과로 구독 상태가 바뀐다. PG는 셀프서비스 단계에서 붙인다.
- 구독 상태: 시안 → 입금 대기 → 활성 → 연체 → 중단 → 해지.
- 연체: 결제일이 지나면 `연체`. 유예 14일 동안 공개를 유지한다. 지나면 공개를 중단(`중단`)하고 호스트네임·데이터는 유지한다. 입금이 확인되면 바로 다시 공개한다(포인터 복구, 재렌더 없음).
- 중단 중 방문자에게는 업체명만 넣은 "준비 중" 페이지를 503 + `Retry-After`로 보여준다. 연체 사실과 연락처·문의 폼은 드러내지 않는다.
- 세금계산서는 홈택스에서 발행하고 콘솔에는 발행 여부만 기록한다.

### 4-11. 운영·AI 도구

- 사이트 제작은 MCP 도구로 한다. 운영자가 Claude/ChatGPT에서 쓰고, 이후 고객 쪽 에이전트에 붙여 셀프서비스로 쓴다. 도구는 하나로 두고 Authentik 그룹(`operator`/`customer`)으로 접근을 나눈다.
- MCP 서버: `apps/api` Worker의 `/mcp`(stateless Streamable HTTP). 인증은 Authentik OAuth. Claude·ChatGPT 원격 커넥터에서 Authentik으로 로그인하고, MCP 서버가 토큰을 JWKS로 직접 검증한다(프록시 없음). 행위는 `audit_log`에 남긴다.
- 도구: 기존 `site_create`, `site_get`, `site_versions`, `site_update_draft`, `site_validate`, `site_preview_url`, `site_publish`, `site_rollback`, `asset_upload`, `template_list`, `template_get`에 더해 `customer_create`, `customer_get`, `site_preview_link`(시안 링크 발급·재발급), `guide_list`, `guide_get`, `guide_create`, `guide_update`(제작 지침 문서), `image_generate`(OpenAI), `asset_import_url`, `asset_list`, `asset_delete`. 상세는 [관리자 콘솔 5절](admin-console.md#5-mcp-도구).
- 해지: 운영자가 콘솔에서 처리한다(자동 전환 없음). 공개 중단(410), 커스텀 도메인 즉시 삭제(과금 중단), 쓰기 거부. 데이터·정적 파일은 해지일부터 1년 보관하고 그동안 zip으로 인출할 수 있다. 1년 후 삭제한다. 자동 삭제는 차후 구현하고, 그 전까지는 운영자가 slug를 입력해야 완전 삭제된다.
- AI 홈페이지 전환: `GET /sites/:id/template-seed`와 `scripts/handoff-to-strapi.mjs`로 create-daniworks-app 프로젝트의 `template-data`를 사이트 내용으로 바꾼 뒤 기존 `template:import`를 쓴다. importer 수정은 필요 없다.

## 5. 아키텍처

```
[관리자 콘솔·MCP] ──────┐
                       ├→ apps/api (Worker) ─→ D1: customers, sites, site_versions, subscriptions, payments, domains, inquiries, metrics_daily
[고객 콘솔(보류)] ──────┘        │
                                └→ 게시: 검증 → packages/renderer → R2 sites/<id>/<ver>/ → KV 포인터
                                                                              ↓
방문자 → <slug>.dsites.kr | 커스텀 도메인 → apps/router (Worker) → R2
                                              └→ /api/inquiry, /api/track (api RPC)
```

### 저장소 구조

```
apps/
  api/        플랫폼 API + MCP 도구 + 게시 파이프라인
  router/     공개 사이트 서빙, 문의·클릭 수집, RSS cron
  console/    관리자 콘솔 (Vite React CSR, MUI). 고객 콘솔은 보류
packages/
  renderer/   업종 템플릿, 사이트 설정 검증, renderToString, 클라이언트 번들 빌드
  schema/     API DTO·플랫폼 메타 스키마(zod) 공유
```

### 주요 의존성

- `@dani-builder/blocks`, `@dani-builder/site-templates`, `@dani-builder/strapi-client` (npm 공개 패키지, 버전 고정)
- Cloudflare: Workers, D1, KV, R2, Cloudflare for SaaS, Turnstile, Email Sending
- Authentik(`authentik.daniworks.kr`): 콘솔 OIDC, MCP OAuth
- OpenAI 이미지 API (`OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`)

### 데이터 모델 (초안)

| 테이블 | 주요 필드 |
| --- | --- |
| `customers` | id, 업체명, 담당자 연락처, external_ref(외부 리드), 사업자번호, 계산서 메일, 상태 |
| `subscriptions` | id, site_id, 요금제, 금액, 주기, 상태, 다음 결제일. 사이트당 정액 |
| `payments` | id, subscription_id, 금액, 수단(manual/pg), 입금자명, 결제일, 확인자, pg_tx_id, 세금계산서 발행일 |
| `sites` | id, customer_id, slug, 업종 템플릿, 템플릿 버전, published_version_id, 상태, preview_token, preview_expires_at |
| `site_versions` | id, site_id, config(JSON), status, created_by(ai/operator), 참고한 지침 버전, created_at, published_at |
| `domains` | id, site_id, hostname, cf_hostname_id, 검증 상태, 인증서 상태 |
| `inquiries` | id, site_id, 항목(JSON), created_at, 알림 결과 |
| `metrics_daily` | site_id, date, event(pageview·tel·kakao·map·booking·inquiry), count |
| `assets` | id, site_id, R2 키, 해시, 크기, 출처(upload/url/ai), ai_generated, 용도, 고객 요청 기록, 생성 비용, created_at |
| `guides`, `guide_versions` | 제작 지침 문서와 섹션 단위 버전 |
| `audit_log` | id, 행위자, 경로(콘솔/MCP/스크립트), 동작, 대상, created_at |
| `change_requests` | id, site_id, 요청 경로(카톡·콘솔 AI), 요청 내용, 처리 버전, 차감 크레딧 |
| `credit_ledger` | id, customer_id, 증감량, 사유(구독 지급·충전·수정 차감), change_request_id, created_at |

## 6. 비기능 요구사항

- 구축 시간: 자료 수집부터 시안 발송까지 운영자 작업 3시간 이하(목표 1시간). M2 실측: AI 시안 3분 17초, $1.02.
- 게시: 요청부터 전 세계 공개 반영까지 1분 이내. 프리뷰는 게시 직후 즉시 확인.
- 성능: 모바일 Lighthouse 성능 90 이상, LCP 2.5초 이하.
- 가용성: 공개 사이트는 정적 파일만 의존. API·DB 장애가 공개 사이트에 영향을 주지 않는다.
- 데이터 소유: 고객 자료·문의 기록은 언제든 인출 가능. 게시 버전 정적 파일 zip 제공.

## 7. 비용 (인프라 고정비, 월)

| 항목 | 100곳 | 300곳 |
| --- | --- | --- |
| Workers Paid (D1·KV 포함) | $5 | $5 |
| Cloudflare for SaaS (100개 무료, 이후 개당 $0.10) | $0 | $20 |
| R2 (무료 10GB) | $0 | $0 |
| 메일 발송 | $0 | $0~20 |
| 도메인 `dsites.kr` | 약 $1 | 약 $1 |
| 합계 | 약 $6 | 약 $26~46 |

- 변동비: AI 초안 생성(시안 1건당 약 $1, M2 실측), OpenAI 이미지 생성(장당 과금, 연동 시 단가 확인). 결제 전 시안도 포함된다.
- Workers·메일 요금은 구현 시점에 재확인한다.

## 8. 위험과 검증 항목

| 위험 | 검증 방법 |
| --- | --- |
| 블록이 Worker 안에서 `renderToString`으로 렌더되지 않음 | 해소: 로컬 workerd에서 렌더·하이드레이션 확인 ([M0 결과](m0-render-poc.md)) |
| 구축 3시간 초과 | M2 실측 AI 시안 3분. 실제 리드 3곳으로 운영자 검수 포함 전체 시간 실측 |
| 국내 등록업체 도메인 연결 실패 | 가비아·후이즈·카페24 등에서 www CNAME 연결 실측, 업체별 안내 문서 작성 |
| 등록업체 루트 포워딩이 https를 지원하지 않음 (`https://customer.kr` 접속 시 인증서 오류) | 같은 업체들에서 http·https 포워딩 각각 실측. 미지원 업체는 네임서버 Cloudflare 이전 안내 또는 도메인 대행 옵션으로 처리 |
| 네이버 블로그 이미지 외부 표시 차단 | 해소: 외부 Referer는 403, Referer 없으면 200. `no-referrer`로 표시 |
| 클라이언트 JS(gzip 94 KiB)로 성능 목표 미달 | 아이콘은 허용 목록으로 해소(M1, fa6 청크 7.9 KiB). 로컬 Lighthouse 99~100(M2). react-dom 비중은 부분 하이드레이션 검토 |
| 템플릿 업데이트로 기존 사이트 깨짐 | 해소: 렌더 버전 기록, 재게시 전 픽셀 비교([M3 결과](m3-operations.md)) |
| 게시·롤백 반영이 1분을 넘음 | 스테이징 실측 최대 60.2초(`cacheTtl` 60초). 30초로 낮춘 뒤 스테이징 재측정 |
| Turnstile 위젯 허용 호스트 수 제한(고객 도메인 수백 개) | 플랫폼 프레임 방식으로 우회. 실제 위젯이 프레임 호스트 기준으로 검증되는지 스테이징 확인 |
| 휴대폰 원본 사진이 Worker 메모리(128MB) 초과 | 3MP 한도, 콘솔에서 브라우저 축소. 운영 Worker에서 3MP 업로드 메모리 재확인 |
| 방문이 뜸한 사이트는 KV 콜드 조회로 첫 바이트가 느림 | 실측: ICN 콜로 TTFB 콜드 약 600ms, 웜 약 150ms. 호스트 키에 포인터를 함께 두어 조회를 1회로 줄였다(M2). 스테이징 재측정 |
| 국내 통신사 회선이 Free 플랜 존을 해외 콜로로 보냄 | 실측: 데이터센터 회선은 ICN, KT는 CMH·LAX(미국), SK브로드밴드는 HKG, LG U+는 NRT. 사무실 회선 TTFB 0.7~1.8초. 통신 3사 모바일·유선에서 Lighthouse를 재고, 플랜별 국내 라우팅 차이를 Cloudflare에 확인(미확인) |
| Claude·ChatGPT 원격 커넥터가 Authentik OAuth와 맞지 않음 | mcp-inspector로 먼저, 이후 실제 커넥터로 실측([관리자 콘솔 4절](admin-console.md#mcp-인증)) |

## 9. 마일스톤

| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| M0 렌더 PoC (완료, [결과](m0-render-poc.md)) | `packages/renderer`: 샘플 설정 → HTML(Worker 실행) | 샘플 사이트가 Worker 렌더 결과로 브라우저에서 정상 표시 |
| M1 게시 PoC (완료, [로컬](m1-publish-poc.md)·[스테이징](staging-deploy.md)) | `apps/api` 사이트·버전 CRUD, 게시·롤백, `apps/router` 서브도메인 서빙 | `<slug>.dsites.kr`에서 게시·롤백 동작 |
| M2 첫 고객 기능 (로컬 완료, [결과](m2-first-customer.md)) | 업종 템플릿 1번, 문의, 측정, MCP 도구 10종, 사진, 커스텀 도메인(내부 등록), 운영자 콘솔 v1 | Docker 검증 통과 |
| M3 운영 기능 (로컬 완료, [결과](m3-operations.md)) | RSS, 분기 리포트, 전체 재게시, 해지·인출, AI 홈페이지 전환 | Docker 검증 통과 |
| M4 운영 체계 | 아래 4-A~4-E. PRD·[관리자 콘솔](admin-console.md)의 과금·시안 링크·Authentik·MCP 제작 도구 | 운영자가 Claude에서 고객 등록부터 시안 링크 발급까지 하고, 콘솔에서 입금 확인 후 게시 |
| M5 첫 고객 오픈 | 스테이징 전체 배포, 실측, 실제 리드 1곳 | 실제 리드 1곳 오픈 |
| M6 10곳 운영 | 업종 템플릿 2~4번, 콘솔 홈(오늘 할 일)·도메인 관제 | 10곳 운영 |
| 셀프서비스 (보류) | Authentik 고객 그룹·가입, 고객 콘솔, PG, AI 수정 크레딧 | 고객이 도움 없이 도메인 연결 |

### M4 세부

| 단계 | 내용 | 비고 |
| --- | --- | --- |
| 4-A 정합화 | 보관 기간 기본값 365일, 중단 페이지(업체명만, 503 + `Retry-After`), CNAME 대상 정리(코드 `fallback.dsites.kr` ↔ 스테이징 `connect.dsites.kr`) | 작은 수정 |
| 4-B 고객·구독·입금 | `customers` 확장, `subscriptions`·`payments`, 게시 시 구독 검사, 상태 전이, 연체 cron(14일 유예 → 자동 중단, 입금 시 재공개), 콘솔 결제·고객 화면 | 첫 고객 오픈의 전제 |
| 4-C 시안 링크 | 사이트 단위 토큰(30일), `dsites.kr/preview/{token}` 서빙, 배너·문의 차단·수집 끔·만료 페이지, 콘솔 복사·폐기·재발급, `site_preview_link` | 4-B와 병행 가능 |
| 4-D Authentik | 콘솔 OIDC(Access 대체, `dsites-console.daniworks.kr`), MCP OAuth(보호 자원 메타데이터, JWKS 검증, 그룹), `audit_log`. 실측 표 완료 | Authentik provider 2개 생성 필요(사용자 작업) |
| 4-E MCP 제작 도구 | `customer_*`, `guide_*`(스키마 문서 자동 생성 포함), `asset_import_url`·`asset_list`·`asset_delete`, `image_generate`, 콘솔 제작 화면을 오타 수정 수준으로 축소 | `OPENAI_IMAGE_MODEL` 결정 필요 |

## 10. 미결 사항

- 요금제 세부: 결제 주기(월·연 선납), 첫 결제일 기준, 부가세 표기. 정책서 기준으로 `subscriptions`에 반영
- 업종 템플릿 2~4번: 운영 자가진단 리드 업종 분포로 결정
- 고객 콘솔 범위와 시점, 셀프서비스 고객 가입을 Authentik에서 받을지(가입 플로우, 카카오 로그인 연동)
- 분기 AI 노출 재측정(geo-prove)과 리포트 생성의 위치: 이 플랫폼 안인지 별도 시스템인지
- 콘솔 AI 수정: 크레딧 수량·충전, 크레딧 차감 단위(요청 1건·게시 1건 등), 게시 전 운영자 검수 여부. 정책서의 '연 4건 수정'과의 관계도 정책서에 반영 필요
- PG 선택과 연동 시점. 그 전까지 수동 입금 확인
- 출시 시 스테이징 분리: 지금은 `dsites.kr`을 스테이징으로 같이 쓴다. 별도 존(도메인)이 필요하다

## 11. 결정 기록

- 2026-11-19: 공개 사이트 기본 도메인은 `dsites.kr`로 확정한다. `dsites.daniworks.kr`은 ACM(월 $10)이 필요하고, for SaaS 라우터의 `*/*` 라우트가 daniworks.kr의 다른 호스트와 충돌한다. 관리자 콘솔은 `dsites-console.daniworks.kr`, 시안 링크는 `dsites.kr/preview/{token}`.
- 2026-11-19: 관리자 콘솔과 MCP 인증은 Authentik으로 한다. M2의 Cloudflare Access는 대체한다.
- 2026-11-19: 해지 후 보관 기간은 1년. 자동 삭제는 차후 구현하고 그 전까지 수동 완전 삭제만 둔다(M3의 기본 90일을 바꾼다).
- 2026-11-19: 결제 전 게시는 예외 없이 막는다. 구독 단위는 사이트, 고객 1 : 사이트 N. 지금은 수동 입금 확인.
- 2026-11-19: 사이트 제작은 MCP로 한다. 콘솔에는 사이트 생성·콘텐츠 편집 화면을 두지 않는다(급한 오타 수정만).
- 2026-11-19: M3 로컬 완료(업종 템플릿 2~4번 제외). 렌더 버전(RENDER_VERSION)으로 재게시 대상 판정, 완전 삭제는 수동·보관 기간 뒤.
- 2026-11-19: M2 로컬 완료. Turnstile 프레임 방식, 사진 3MP 한도, 렌더 불변화(render_id).
- 2026-11-19: DB는 D1을 유지한다. 측정도 D1 일별 집계로 한다. 메일은 Cloudflare Email Sending, 로컬은 Mailpit.
- 2026-11-19: 라우터 KV `cacheTtl`을 30초로 낮추고, 호스트 키에 게시 포인터를 함께 둬 조회를 1회로 줄인다.
- 2026-11-19: 고객 콘솔은 보류한다.
- 2026-11-19: 로컬 검증은 Docker(`docker-compose.yml`)에서 한다. 단계마다 `codex review`를 거친다.

---
type: spec
status: draft
date: 2026-11-18
product: 스타터 홈페이지
---

# 관리자 콘솔

운영자(다니웍스)가 시안 검수, 게시, 입금 확인, 도메인 관제를 하는 내부 화면이다. 요구사항 전체는 [PRD](prd.md)를 따른다.

## 1. 역할 분담

| 일 | 도구 |
| --- | --- |
| 리드 접수·연락 | 외부(노션 등). 이 플랫폼에 저장하지 않는다 |
| 고객 등록, 사이트 생성, 설정·콘텐츠 작성, 사진 업로드 | Claude/ChatGPT + MCP 도구 |
| 검수, 게시·롤백, 입금 확인, 도메인, 고객·결제 조회 | 관리자 콘솔 |

- 콘솔에는 사이트 생성 화면과 콘텐츠 편집 폼을 두지 않는다. 제작은 MCP가 맡는다.
- MCP 도구는 이후 고객 쪽 에이전트에 그대로 붙여 셀프서비스로 쓴다. 그래서 게시 시 결제 검사 같은 규칙은 콘솔이 아니라 API에 둔다.

## 2. 업무 흐름

| 단계 | 어디서 | 하는 일 | 상태 |
| --- | --- | --- | --- |
| 1. 리드 | 외부 | 접수, 연락 | - |
| 2. 제작 | MCP | 고객 등록 → 사이트 생성 → 설정·콘텐츠 등록 → 시안 링크 발급 | 구독: 시안 |
| 3. 시안 발송 | 카톡 | 시안 링크 전달 | 구독: 시안 |
| 4. 입금 확인 | 콘솔 | 청구 건에 입금 매칭 | 구독: 활성 |
| 5. 게시 | 콘솔 또는 MCP | 구독이 활성일 때만 가능 | 사이트: 공개 |
| 6. 도메인 | 콘솔(이후 고객 콘솔) | 호스트네임 등록, DNS 안내, 상태 확인 | 도메인: 대기 → 연결 |
| 7. 수정 | MCP → 콘솔 | draft 생성 → 검수 → 게시 | - |
| 8. 연체·해지 | 콘솔 | 14일 유예 후 공개 중단, 해지 시 호스트네임 삭제 | 구독: 연체 → 중단 → 해지 |

## 3. 정책

### 과금

- 구독 단위는 사이트다. 고객 1명이 사이트 여러 개를 가질 수 있고, 사이트마다 정액으로 청구한다.
- 지금은 수동 입금 확인이다. PG는 나중에 붙인다.
- 수동 확인과 PG 웹훅은 둘 다 `payments` 행을 만들고, 그 결과로 구독 상태가 바뀐다. PG를 붙일 때 결제 수단만 늘리면 된다.
- 세금계산서는 홈택스에서 발행한다. 콘솔에는 발행 여부만 기록한다.

### 연체

- 결제일이 지나면 구독은 `연체`가 된다. 유예 기간은 **14일**이고, 그동안 사이트는 공개를 유지한다.
- 14일이 지나도 입금이 없으면 공개를 중단하고 구독은 `중단`이 된다. 호스트네임과 데이터는 유지한다.
- 중단 중 방문자에게는 "준비 중" 안내 페이지를 보여준다. 연체·미납 사실은 드러내지 않는다. 라우터가 공용 정적 페이지 하나를 503 + `Retry-After`로 응답해 검색 순위 손실을 줄인다. 업체명만 표시하고 연락처·문의 폼은 넣지 않는다.
- `중단` 중 입금이 확인되면 바로 다시 공개한다(KV 포인터 복구, 재렌더 없음).
- 해지는 자동으로 넘어가지 않는다. 운영자가 콘솔에서 사이트 상태를 `해지`로 바꿔 처리한다(고객 요청, 장기 미납 등). 해지 시 공개를 중단하고 호스트네임을 삭제한다. 데이터·정적 파일은 해지일부터 1년 보관하고 그동안 인출할 수 있다. 1년 후 삭제한다(자동 삭제는 차후 구현).

### 공개

- 결제 확인 전에는 게시할 수 없다. 예외는 두지 않는다.
- API가 게시 요청마다 구독 상태를 검사한다. 콘솔과 MCP 모두 같은 검사를 거친다.

### 시안 링크

- 형식: `https://dsites.kr/preview/{token}`
- 사이트 단위 토큰이다. 항상 최신 draft를 보여주므로 시안을 고쳐도 링크가 바뀌지 않는다.
- 내부 검수용으로는 버전 단위 프리뷰 링크를 따로 둔다(M1의 `api.dsites.kr/preview/<token>`).
- 유효기간은 30일(확정). 콘솔에서 폐기·재발급한다. 만료되면 안내 페이지를 보여준다.
- 시안 화면에서만 달라지는 것:
  - 상단 고정 배너: "시안입니다. 아직 공개되지 않은 페이지입니다."
  - 문의 폼 전송 차단, "시안에서는 문의가 전송되지 않습니다" 표시
  - 클릭 수집 끔
  - `noindex`, 캐시 안 함
- 하위 페이지(개인정보처리방침 등) 링크가 루트 기준이면 `/preview/{token}/…`로 바꿔야 한다. 렌더러 기준 경로 옵션을 구현 시 확인한다.

## 4. 도메인과 인증

| 주소 | 용도 |
| --- | --- |
| `<slug>.dsites.kr` | 공개 사이트 기본 주소 |
| `dsites.kr/preview/{token}` | 시안 |
| `api.dsites.kr` | 플랫폼 API, MCP(`/mcp`), 버전 프리뷰 |
| `dsites-console.daniworks.kr` | 관리자 콘솔 |
| `authentik.daniworks.kr` | 운영자 로그인(OIDC) |

- 공개 사이트는 `dsites.kr` 존에 둔다. for SaaS 라우터가 존의 `*/*` 라우트를 잡아야 해서 daniworks.kr 존에는 둘 수 없다. 1단계 와일드카드라 Universal SSL로 덮여 ACM이 필요 없다.
- 콘솔 로그인은 Authentik OIDC(Authorization Code + PKCE)다. 운영자 계정은 Authentik에서 관리하고 콘솔에는 두지 않는다. M2의 Cloudflare Access(`admin.dsites.kr`)를 대체했다(4-D).
- 콘솔 Worker가 OIDC 세션을 들고(브라우저에는 세션 쿠키만), API 요청에 Authentik 액세스 토큰을 붙인다. API는 MCP와 같은 경로로 JWKS 검증해 운영자를 식별한다. 게시·롤백·입금 확인 기록에 운영자 ID를 남긴다.
- 스크립트용 고정 토큰(`ADMIN_TOKEN`)은 배포·공용 에셋 업로드·재게시 등 사람이 없는 작업에만 쓴다.

### MCP 인증

daniworks-home `apps/mcp-gateway`([운영 문서](https://github.com/HJ-company/daniworks-home/blob/main/docs/operations/mcp-gateway.md))와 같은 Authentik 설정을 쓴다.

| 항목 | 값 |
| --- | --- |
| Authentik provider | 전용 OAuth2/OIDC provider. Confidential client, Authorization Code + PKCE S256, 액세스 토큰 JWT RS256 |
| 클라이언트 등록 | 사전 등록 client 하나를 Claude·ChatGPT가 같이 쓴다. 동적 등록은 쓰지 않는다 |
| 콜백 | Claude `https://claude.ai/api/mcp/auth_callback`, ChatGPT `https://chatgpt.com/connector_platform_oauth_redirect`, mcp-inspector `http://localhost:6274/oauth/callback`(실측용). 와일드카드 금지, 연결 시 각 UI에서 재확인 |
| 토큰 검증 | JWKS 서명, issuer, `aud`=client_id 고정, `exp` 필수 |
| 메타데이터 | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`. 인증 실패 시 401 + `WWW-Authenticate: Bearer resource_metadata=…` |
| 클레임 | Authentik scope mapping으로 `groups`를 넣는다. 셀프서비스 때 customer_id 추가 |

daniworks-home과 다른 점: **프록시를 두지 않는다.** 게이트웨이는 검증 후 토큰을 Strapi admin 토큰으로 바꿔 모든 사용자가 같은 권한이 된다. 이 플랫폼은 감사 기록과 고객별 권한이 필요하므로 MCP 서버를 `apps/api` Worker 안에 두고 JWT를 직접 검증한다(jose). 검증한 `sub`·`groups`로 권한을 판단하고 `audit_log`에 남긴다.

권한은 Authentik 그룹으로 나눈다. `operator`는 전체, 셀프서비스 고객은 `customer` 그룹 + customer_id 클레임으로 본인 사이트만 접근한다. 도구는 하나로 둔다.

설정 값(M4 4-D 구현 기준). Authentik은 애플리케이션마다 issuer가 다르므로 둘을 따로 만든다.

| 항목 | 콘솔 | MCP |
| --- | --- | --- |
| Authentik 애플리케이션 slug(issuer) | `dsites-console` (`https://authentik.daniworks.kr/application/o/dsites-console/`) | `dsites-mcp` (`…/application/o/dsites-mcp/`) |
| Client | Confidential, `dsites-console` | Confidential, `dsites-mcp` |
| Redirect URI | `https://dsites-console.daniworks.kr/auth/callback` | Claude·ChatGPT·mcp-inspector 콜백(위 표) |
| Scope | `openid profile email offline_access` + `groups` 매핑 | 같음 |
| 접근 | Authentik 그룹 `operator` | 같음 |
| Worker 설정 | 콘솔: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, secret `OIDC_CLIENT_SECRET`, `SESSION_SECRET`(32자 이상) | api: `CONSOLE_OIDC_*`, `MCP_OIDC_*`(issuer·client id) |

- 콘솔 Worker가 코드를 토큰으로 바꾸고 암호화한 HttpOnly 쿠키(필요하면 여러 개로 나눔)에 둔다. API 호출에는 운영자 본인의 액세스 토큰을 붙이고, 만료 60초 전부터 갱신한다.
- API는 토큰의 issuer·aud로 콘솔·MCP를 구분해 JWKS로 검증하고 `operator` 그룹이 없으면 403을 준다. 스크립트용 `ADMIN_TOKEN`은 그대로 쓴다.
- 모든 변경(거부 포함)은 `audit_log`에 남는다. 사이트 개요의 "작업 기록"에 누가(운영자 이름·AI 도구·스크립트) 무엇을 했는지 보인다. 입금 확인자는 로그인한 운영자 이름이다.

실측(로컬은 Authentik 목업 `docker/oidc-mock.mjs`, `verify-m4-auth.mjs`). 실제 Authentik과 커넥터는 공개 주소가 필요해 스테이징(M5)에서 잰다.

| 항목 | 로컬(목업) | 스테이징(실제 Authentik) |
| --- | --- | --- |
| 401 → 보호 자원 메타데이터 → 인가 서버 → 로그인(PKCE S256) → 토큰 | 통과 | 미실행 |
| Authentik 인가 서버 discovery(RFC8414 또는 OIDC fallback) | 통과(목업은 둘 다 제공) | 미실행: Authentik이 RFC8414 경로를 주는지 확인 |
| 토큰 `aud`·`groups` 클레임 | 통과 | 미실행: scope mapping으로 `groups` 추가 필요 |
| 도구 목록·호출, 그룹 없는 계정 403, 위조·만료 토큰 401 | 통과 | 미실행 |
| 콘솔 세션 유지, 만료 전 갱신, 동시 요청, 만료 후 복귀, 로그아웃 | 통과 | 미실행 |
| Claude 커넥터 연결 | - | 미실행 |
| ChatGPT 커넥터 연결(Developer mode 가능 여부 포함) | - | 미실행 |

## 5. MCP 도구

### 제작 지침 문서

context7처럼 MCP를 연결하면 제작에 필요한 지침을 바로 찾아 읽게 한다.

| 문서 | 원본 | 수정 방식 |
| --- | --- | --- |
| 블록·사이트 설정 스키마 | `@dani-builder/blocks`, `packages/renderer` 코드 | 빌드 때 자동 생성. MCP로 고치지 않는다 |
| 상품·계약 지침 | 노션 정책서 | 요약본 등록 |
| 업종별 지침(음식점, 시공·설비, 뷰티, B2B) | 이 플랫폼 | MCP로 추가·편집 |
| 디자인 지침(색, 사진 톤, 섹션 구성) | 이 플랫폼 | MCP로 추가·편집 |
| 작성 규칙(카피 톤, 금지 표현, 구조화 데이터, 이미지 용도) | 이 플랫폼 | MCP로 추가·편집 |

| 도구 | 하는 일 | 권한 |
| --- | --- | --- |
| `guide_list` | 문서 목록(주제, 종류, 요약, 버전) | 전체 |
| `guide_get` | 주제·질문으로 관련 섹션만 반환 | 전체 |
| `guide_create` | 새 문서 등록 | operator |
| `guide_update` | 섹션 단위 수정, 새 버전으로 쌓임 | operator |

- D1에 문서·섹션을 append-only 버전으로 저장한다. 검색은 제목·키워드로 시작하고 문서가 늘면 Vectorize를 붙인다.
- 문서마다 공개 범위(`operator`/`customer`)를 둔다.
- 사이트 버전 저장 시 참고한 지침 버전을 함께 기록한다.
- MCP 서버 설명에 "제작 전에 `guide_get`으로 스키마와 업종 지침부터 읽는다"를 넣는다. resources·prompts는 클라이언트 지원이 고르지 않아 도구로 제공한다.

### 이미지

| 도구 | 하는 일 |
| --- | --- |
| `image_generate` | 프롬프트·비율·site_id → OpenAI 이미지 API로 생성 → WebP 변환 → R2 저장 → asset 키·CDN 주소 반환 |
| `asset_import_url` | 블로그·플레이스의 고객 사진 URL을 서버가 받아 R2에 저장 |
| `asset_upload` | 작은 파일 직접 업로드(base64) |
| `asset_list`, `asset_delete` | 사이트별 자산 관리 |

- 저장·서빙은 M2의 사진 경로(R2, WebP 변형 3종, 내용 해시 키)를 그대로 쓴다. 설정에는 키만 저장한다.
- 생성 이미지는 배경·일러스트·분위기 이미지에만 쓴다. 시공 사례·음식·매장 등 실제 작업물은 고객 사진만 쓴다.
- 예외: 고객이 직접 요청하면 실제 작업물 용도로도 생성한다. `image_generate`에 `customer_request`(요청 경로·일시·내용 요약)를 받아 자산에 남긴다. 요청 기록 없이는 기본 용도만 허용한다.
- 자산에 `ai_generated`를 기록한다.
- 생성마다 비용을 기록한다. 셀프서비스에서는 크레딧으로 차감한다.
- 환경 변수: `OPENAI_API_KEY`(secret), `OPENAI_IMAGE_MODEL`. 로컬은 `apps/api/.dev.vars`, 운영은 `wrangler secret put`.

## 6. 메뉴와 화면

### 홈

- 오늘 할 일: 검수 대기 draft, 입금 대기, 연체(유예 만료 임박), 도메인 오류, 문의 알림 실패, 만료 임박 시안

### 고객

- 목록: 사이트 수, 월 청구 합계, 상태
- 상세: 연락처, 청구 정보(사업자번호, 계산서 메일), 외부 리드 링크, 사이트별 구독, 결제 이력

### 사이트

- 목록: 사이트 상태, 구독 상태, 도메인 연결 여부
- 상세 탭
  - 개요: 공개 주소, 게시 버전, 구독 상태, 시안 링크(복사·폐기·재발급)
  - 버전: 목록, 변경 비교, 프리뷰, 게시, 롤백
  - 설정: JSON 조회. 수정은 MCP로 하고 콘솔에서는 급한 오타 수정만 허용
  - 도메인: 호스트네임 등록, CNAME·TXT 안내값, 검증·인증서 상태
  - 문의: 방문자 문의 목록, 알림 결과
  - 통계: 방문, 전화·카톡·지도 클릭

### 결제

- 입금 대기: 청구 건 목록에서 입금자명·금액으로 확인하고 매칭
- 결제 내역: 수단·기간 필터, 세금계산서 발행 여부
- 연체: 유예 남은 일수, 중단 대상(14일 경과), 중단·재공개 처리
- 해지: 사이트 상세에서 운영자가 상태를 `해지`로 변경. 사유 입력, 확인 후 호스트네임 삭제

### 운영

- 지침 문서: 목록, 버전 이력·변경 비교, 공개 범위. 작성·수정은 MCP로 한다
- 이미지: 사이트별 자산, AI 생성 여부, 생성 비용 합계
- 도메인: 전체 호스트네임 상태, 오류 목록, SaaS quota
- 리포트: 분기 리포트 생성·발송 현황(M3)

### 설정

- 요금제
- 템플릿 버전, 전체 재게시

## 7. 데이터 모델 추가·변경

| 테이블 | 주요 필드 |
| --- | --- |
| `customers` | + external_ref(외부 리드 링크), 사업자번호, 계산서 메일 |
| `sites` | + preview_token, preview_expires_at |
| `subscriptions` | site_id, 주기(월·연), 금액, 상태(시안/입금 대기/활성/연체/중단/해지, 이용 기간에서 계산), 청구일 |
| `payments` | id, site_id·slug·상호, 금액, 수단(manual/pg), 입금자명, 입금일, 이용 기간(운영자 수정 가능), 확인자, pg_tx_id, 세금계산서 발행일, 취소 사유 |
| `guides` | id, 주제, 종류(스키마/계약/업종/디자인/작성 규칙), 공개 범위, 현재 버전 |
| `guide_versions` | id, guide_id, 본문(섹션 단위 markdown), 작성자, created_at |
| `site_versions` | + guide_versions(참고한 지침 버전 목록) |
| `assets` | id, site_id, R2 키, 해시, 크기, 출처(upload/url/ai), ai_generated, 프롬프트, 용도(기본/고객 요청), 고객 요청 기록, 생성 비용, created_at |
| `audit_log` | id, 행위자(Authentik 사용자 ID 또는 스크립트), 경로(콘솔/MCP/스크립트), 동작, 대상, created_at |

## 8. 우선순위

PRD [9절 마일스톤](prd.md#9-마일스톤)과 같은 단계 이름을 쓴다.

| 단계 | 범위 | 현재 |
| --- | --- | --- |
| M2·M3 (완료) | MCP 도구 10종(고정 토큰), 콘솔 v1(Access, 사이트 생성·편집 포함), 사이트 상세(버전·도메인·문의·통계·리포트), 해지·인출, 전체 재게시 | 로컬 완료 |
| M4 운영 체계 | 4-A 정합화, 4-B 고객·구독·입금(게시 시 결제 검사, 연체 처리, 결제·고객 화면), 4-C 시안 링크, 4-D Authentik(콘솔·MCP, 실측 표 완료, `audit_log`), 4-E MCP 제작 도구(고객, 지침 문서, 이미지 생성·가져오기, 자산 관리) | 미착수 |
| M5 첫 고객 오픈 | 스테이징 전체 배포와 실측 | 미착수 |
| M6 10곳 운영 | 홈(오늘 할 일), 도메인 관제, 운영 메뉴(지침·이미지·리포트 현황) | 미착수 |
| 셀프서비스 | Authentik 고객 그룹·가입, 고객 콘솔, PG | 보류 |
| 차후 | 해지 1년 경과 데이터 자동 삭제 | - |

## 9. 미결 사항

- 셀프서비스 고객 가입을 Authentik에서 받을지(가입 플로우, 카카오 로그인 연동)

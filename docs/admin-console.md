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
- `중단` 중 입금이 확인되면 바로 다시 공개한다(KV 포인터 복구, 재렌더 없음).
- 해지는 고객 요청 또는 장기 미납 시 운영자가 처리한다. 이때 호스트네임을 삭제한다.

### 공개

- 결제 확인 전에는 게시할 수 없다. 예외는 두지 않는다.
- API가 게시 요청마다 구독 상태를 검사한다. 콘솔과 MCP 모두 같은 검사를 거친다.

### 시안 링크

- 형식: `https://dsites.daniworks.kr/preview/{token}`
- 사이트 단위 토큰이다. 항상 최신 draft를 보여주므로 시안을 고쳐도 링크가 바뀌지 않는다.
- 내부 검수용으로는 버전 단위 프리뷰 링크를 따로 둔다(M1의 `/preview/:token`).
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
| `<slug>.dsites.daniworks.kr` | 공개 사이트 기본 주소 |
| `dsites.daniworks.kr/preview/{token}` | 시안 |
| `dsites-console.daniworks.kr` | 관리자 콘솔 |
| `authentik.daniworks.kr` | 운영자 로그인(OIDC) |

- 콘솔 로그인은 Authentik OIDC(Authorization Code + PKCE)다. 운영자 계정은 Authentik에서 관리하고 콘솔에는 두지 않는다.
- API는 Authentik 액세스 토큰을 JWKS로 검증해 운영자를 식별한다. 게시·롤백·입금 확인 기록에 운영자 ID를 남긴다.
- 스크립트용 고정 토큰(`ADMIN_TOKEN`)은 배포·공용 에셋 업로드 등 사람이 없는 작업에만 쓴다.
- `*.dsites.daniworks.kr`은 2단계 와일드카드라 Cloudflare 기본 인증서(Universal SSL, `*.daniworks.kr`까지만)로 덮이지 않는다. Advanced Certificate Manager(월 $10)가 필요하다.

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

M2 실측(mcp-inspector로 먼저, 이후 Claude·ChatGPT 실제 커넥터):

| 항목 | 결과 |
| --- | --- |
| 메타데이터 탐색 → Authentik 로그인 → 토큰 발급 | 미실행 |
| Authentik 인가 서버 discovery(RFC8414 또는 OIDC fallback) | 미실행 |
| 토큰 `aud`·`groups` 클레임 | 미실행 |
| 도구 목록·호출, 그룹별 거절 | 미실행 |
| 세션 유지, 만료 후 갱신·재로그인 | 미실행 |
| Claude 커넥터 연결 | 미실행 |
| ChatGPT 커넥터 연결(Developer mode 가능 여부 포함) | 미실행 |

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

- CDN 주소: `dsites.daniworks.kr/assets/<siteId>/<hash>.webp`. 내용 해시 경로라 영구 캐시. 설정에는 키만 저장한다.
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
| `subscriptions` | id, site_id, 요금제, 금액, 주기, 상태(시안/입금 대기/활성/연체/중단/해지), 다음 결제일 |
| `payments` | id, subscription_id, 금액, 수단(manual/pg), 입금자명, 결제일, 확인자, pg_tx_id, 세금계산서 발행일 |
| `guides` | id, 주제, 종류(스키마/계약/업종/디자인/작성 규칙), 공개 범위, 현재 버전 |
| `guide_versions` | id, guide_id, 본문(섹션 단위 markdown), 작성자, created_at |
| `site_versions` | + guide_versions(참고한 지침 버전 목록) |
| `assets` | id, site_id, R2 키, 해시, 크기, 출처(upload/url/ai), ai_generated, 프롬프트, 용도(기본/고객 요청), 고객 요청 기록, 생성 비용, created_at |
| `audit_log` | id, 행위자(Authentik 사용자 ID 또는 스크립트), 경로(콘솔/MCP/스크립트), 동작, 대상, created_at |

## 8. 우선순위

| 단계 | 범위 |
| --- | --- |
| M2 | MCP 서버 + Authentik OAuth(실측 표 완료), MCP 도구(고객·사이트 생성, draft 저장, 지침 문서 읽기·편집, 이미지 생성·가져오기, 시안 링크), 게시 시 결제 검사, 콘솔: 로그인, 사이트 상세(개요·버전), 입금 확인, 고객 상세 |
| M3 | 홈(오늘 할 일), 도메인 관제, 연체 처리, 리포트, 통계 |
| 셀프서비스 | Authentik 고객 그룹·가입, 고객 콘솔, PG |

## 9. 미결 사항

- 공개 중단 시 방문자에게 보여줄 화면
- 중단 후 해지로 넘기는 기준(미납 기간)
- 셀프서비스 고객 가입을 Authentik에서 받을지(가입 플로우, 카카오 로그인 연동)

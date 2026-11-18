---
type: prd
status: draft
date: 2026-11-18
product: 스타터 홈페이지
policy: https://app.notion.com/p/41cecd5a3ac28107820effaeb6cb4fc8
---

# 스타터 홈페이지 플랫폼 PRD

상품 정책(가격·제공 범위·계약·판매 기준)은 노션 정책서가 기준이다. 이 문서는
그 정책을 만족시키는 플랫폼의 요구사항과 기술 구조를 다룬다. 둘이 어긋나면
정책서를 따르고 이 문서를 고친다.

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
| 운영자(다니웍스) | 시안 검수, 게시, 수정 요청 처리, 도메인 문제 대응 | 내부 어드민 API, AI 도구 |
| AI 에이전트 | 자료 수집 결과로 설정 초안 작성, 수정 요청 반영 | MCP 도구(플랫폼 API) |
| 고객(사장님) | 시안 확인, 도메인 연결, 문의 확인, 리포트 열람, 수정 요청 | 시안 링크, 고객 콘솔 |
| 방문자 | 사이트 열람, 전화·카톡·지도·문의 | 공개 사이트 |

### 제작 흐름

1. 수집: 자가진단 리드 데이터 + geo-prove 결과 + 블로그·플레이스·인스타 URL
2. 초안: AI가 업종 템플릿을 고르고 사이트 설정을 작성해 `draft` 버전으로 저장
3. 검수: 스키마 검증 통과 후 운영자가 프리뷰 URL에서 확인·수정
4. 시안: 프리뷰 링크를 카톡으로 발송
5. 오픈: 결제 확인 후 게시. `<slug>.dsites.co.kr`로 즉시 공개
6. 도메인: 고객이 콘솔에서 커스텀 도메인 등록 → DNS 안내 → 연결 확인
7. 운영: 카톡 수정 요청을 AI가 `draft`로 반영 → 운영자 검수 → 게시

## 4. 기능 요구사항

### 4-1. 사이트 설정

- 형식: `@dani-builder/site-templates`의 `TemplateSeed` + 플랫폼 메타(연락처, 업종, 도메인, RSS URL 등).
- 저장 전 `collectSeedValidationErrors`와 플랫폼 스키마로 검증한다. 검증 실패는 저장하지 않는다.
- 업종 템플릿 4종: 음식점, 시공·설비, 뷰티·서비스, 1인·소규모 B2B.
- 사진은 R2에 업로드하고 설정에는 키만 저장한다.

### 4-2. 버전과 게시

- 모든 저장은 `site_versions`에 새 행으로 쌓는다(append-only).
- 상태: `draft` → `published`. 게시된 버전은 사이트당 하나다.
- 게시 = 검증 → HTML 렌더 → R2 `sites/<siteId>/<versionId>/` 업로드 → KV 포인터 교체.
- 롤백 = KV 포인터를 이전 버전으로 교체. 재렌더하지 않는다.
- 프리뷰: `draft` 버전도 렌더해 `preview-<token>.dsites.co.kr`(또는 경로)로 볼 수 있다. 검색엔진 차단.

### 4-3. 렌더링

- 템플릿 버전마다 한 번: CSS와 클라이언트 JS 번들(슬라이더·FAQ·문의 폼 등 인터랙션)을 빌드해 R2 공용 경로에 둔다.
- 게시마다: `@dani-builder/blocks`로 `renderToString`해 HTML 한 장을 만든다. 빌드 서버 없이 Worker에서 실행하는 것이 목표.
- 출력에 포함: 구조화 데이터(업체·영업시간·서비스·지역), 메타·OG, 사이트맵, robots, 개인정보처리방침 페이지.
- 템플릿 업데이트 시 전체 사이트를 재게시하는 운영 명령을 둔다.

### 4-4. 라우팅·도메인

- 기본 도메인: `*.dsites.co.kr` 와일드카드. slug는 사이트 생성 시 확정.
- 커스텀 도메인: Cloudflare for SaaS 커스텀 호스트네임. 콘솔에서 등록하면 API로 호스트네임을 만들고, 고객에게 CNAME·TXT 값을 보여주고, 상태를 확인해 표시한다.
- 루트 도메인(example.com)은 국내 등록업체 대부분이 CNAME/ALIAS를 지원하지 않는다. 안내 기본값은 `www` 연결 + 등록업체 포워딩.
- 라우터 Worker: Host → siteId(KV) → 게시 버전 포인터(KV) → R2 객체. 커스텀 도메인 연결 후 기본 도메인은 커스텀 도메인으로 리다이렉트.

### 4-5. 문의

- 공용 엔드포인트 `POST /api/inquiry`. Host로 사이트를 판별해 D1에 저장한다.
- Turnstile로 스팸 차단. 고객에게 메일 알림(기본). 알림톡은 유료 옵션으로 후순위.
- 고객 콘솔에서 문의 목록 열람·내보내기.

### 4-6. 측정

- 방문: Cloudflare Web Analytics 또는 라우터 Worker 집계.
- 클릭: 전화·카톡·지도·네이버 예약·문의 버튼 클릭을 `POST /api/track`으로 수집(Workers Analytics Engine).
- 분기 리포트용 사이트별·기간별 집계 API.

### 4-7. 블로그 최신 글

- 네이버 블로그 RSS를 Worker cron이 수집해 KV에 캐시하고, 페이지는 런타임에 읽어 표시한다. 글이 올라와도 재게시하지 않는다.
- 네이버 이미지 외부 표시가 막힐 수 있다. 텍스트 카드 또는 Worker 프록시 중 PoC에서 정한다.
- 인스타 최신 게시물: 1차 범위 제외. Graph API는 비즈니스 계정·페이스북 페이지 연결·고객별 토큰 갱신이 필요하다.

### 4-8. 고객 콘솔

- 로그인: 이메일 매직링크(카카오 로그인은 후순위).
- 기능: 사이트 상태, 커스텀 도메인 연결, 문의 목록, 분기 리포트 열람, 수정 요청 접수, 정적 파일 다운로드(게시 버전 zip).
- 콘텐츠 편집 기능은 넣지 않는다.

### 4-9. 운영·AI 도구

- 플랫폼 API를 MCP 도구로도 노출: `site_create`, `site_get`, `site_update_draft`, `site_validate`, `site_preview_url`, `site_publish`, `site_rollback`, `asset_upload`.
- 해지: 공개 중단(라우터에서 차단), 데이터·정적 파일은 보관 후 인출 가능.
- AI 홈페이지 전환: 사이트 설정(TemplateSeed)을 Strapi로 가져오는 스크립트. `create-daniworks-app` importer를 고객 seed를 받도록 확장하는 방향.

## 5. 아키텍처

```
[내부 어드민·AI(MCP)] ─┐
                       ├→ apps/api (Worker) ─→ D1: customers, sites, site_versions, domains, inquiries
[고객 콘솔] ────────────┘        │
                                └→ 게시: 검증 → packages/renderer → R2 sites/<id>/<ver>/ → KV 포인터
                                                                              ↓
방문자 → <slug>.dsites.co.kr | 커스텀 도메인 → apps/router (Worker) → R2
                                              └→ /api/inquiry, /api/track
```

### 저장소 구조

```
apps/
  api/        플랫폼 API + MCP 도구 + 게시 파이프라인
  router/     공개 사이트 서빙, 문의·클릭 수집, RSS cron
  console/    고객 콘솔 (후순위)
packages/
  renderer/   템플릿 4종, 사이트 설정 스키마, renderToString, 클라이언트 번들 빌드
  schema/     DB 스키마·사이트 설정 타입 공유
```

### 주요 의존성

- `@dani-builder/blocks`, `@dani-builder/site-templates`, `@dani-builder/strapi-client` (npm 공개 패키지, 버전 고정)
- Cloudflare: Workers, D1, KV, R2, Cloudflare for SaaS, Turnstile, Analytics Engine

### 데이터 모델 (초안)

| 테이블 | 주요 필드 |
| --- | --- |
| `customers` | id, 업체명, 담당자 연락처, 결제 주기, 상태 |
| `sites` | id, customer_id, slug, 업종 템플릿, 템플릿 버전, published_version_id, 상태 |
| `site_versions` | id, site_id, config(JSON), status, created_by(ai/operator), created_at, published_at |
| `domains` | id, site_id, hostname, cf_hostname_id, 검증 상태, 인증서 상태 |
| `inquiries` | id, site_id, 항목(JSON), created_at, 알림 결과 |
| `change_requests` | id, site_id, 요청 내용, 처리 버전, 연간 차감 여부 |

## 6. 비기능 요구사항

- 구축 시간: 자료 수집부터 시안 발송까지 운영자 작업 3시간 이하(목표 1시간).
- 게시: 요청부터 공개 반영까지 10초 이하.
- 성능: 모바일 Lighthouse 성능 90 이상, LCP 2.5초 이하.
- 가용성: 공개 사이트는 정적 파일만 의존. API·DB 장애가 공개 사이트에 영향을 주지 않는다.
- 데이터 소유: 고객 자료·문의 기록은 언제든 인출 가능. 게시 버전 정적 파일 zip 제공.

## 7. 비용 (인프라 고정비, 월)

| 항목 | 100곳 | 300곳 |
| --- | --- | --- |
| Workers Paid (D1·KV·Analytics Engine 포함) | $5 | $5 |
| Cloudflare for SaaS (100개 무료, 이후 개당 $0.10) | $0 | $20 |
| R2 (무료 10GB) | $0 | $0 |
| 메일 발송 | $0 | $0~20 |
| 도메인 `dsites.co.kr` | 약 $1 | 약 $1 |
| 합계 | 약 $6 | 약 $26~46 |

- 변동비: AI 초안 생성(시안 1건당 수백~1천원대 추정). 결제 전 시안도 포함된다.
- Workers·메일 요금은 구현 시점에 재확인한다.

## 8. 위험과 검증 항목

| 위험 | 검증 방법 |
| --- | --- |
| 블록이 Worker 안에서 `renderToString`으로 렌더되지 않음 | 해소: 로컬 workerd에서 렌더·하이드레이션 확인 ([M0 결과](m0-render-poc.md)) |
| 구축 3시간 초과 | 사이트 없는 리드 3곳으로 AI 초안 유무별 실측 |
| 국내 등록업체 도메인 연결 실패 | 가비아·후이즈 등에서 www CNAME + 루트 포워딩 실측 |
| 네이버 블로그 이미지 외부 표시 차단 | RSS 수집 PoC에서 확인 |
| 클라이언트 JS(gzip 94 KiB)와 아이콘 세트 크기로 성능 목표 미달 | M0에서 측정. 부분 하이드레이션·아이콘 분할 검토 |
| 템플릿 업데이트로 기존 사이트 깨짐 | 템플릿 버전을 사이트별로 기록, 재게시 전 시각 회귀 확인 |

## 9. 마일스톤

| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| M0 렌더 PoC | `packages/renderer`: 샘플 설정 → HTML(Worker 실행) | 샘플 사이트가 Worker 렌더 결과로 브라우저에서 정상 표시 |
| M1 게시 PoC | `apps/api` 사이트·버전 CRUD, 게시·롤백, `apps/router` 서브도메인 서빙 | `<slug>.dsites.co.kr`에서 게시·롤백 동작 |
| M2 첫 고객 | 템플릿 1~2종, 문의, 클릭 수집, MCP 도구, 커스텀 도메인(내부 등록) | 실제 리드 1곳 오픈 |
| M3 운영 | 템플릿 4종, RSS, 분기 리포트 집계, 전체 재게시 | 10곳 운영 |
| M4 고객 콘솔 | 도메인 셀프 연결, 문의, 리포트, 수정 요청, zip 다운로드 | 고객이 도움 없이 도메인 연결 |

## 10. 미결 사항

- DB: D1로 충분한지, 콘솔·리포트 요구로 Postgres가 필요한지 (M1에서 결정)
- 고객 콘솔 인증 방식과 계정 모델(고객 1 : 사이트 N 허용 여부)
- 분기 AI 노출 재측정(geo-prove)과 리포트 생성의 위치: 이 플랫폼 안인지 별도 시스템인지
- 해지 후 데이터 보관 기간
- `dsites.co.kr`은 예시. 실제 도메인 확정 필요

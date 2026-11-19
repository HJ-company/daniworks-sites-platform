---
type: result
status: current
date: 2026-11-19
milestone: M1
---

# 스테이징 배포 (dsites.kr)

결론: M1 흐름(생성 → 프리뷰 → 게시 → 수정 → 재게시 → 롤백)이 실제 도메인 `https://<slug>.dsites.kr`에서 동작한다. `verify-staging` 18/18을 두 번 통과했다. 게시·롤백의 전 세계 반영은 최대 60.2초로 PRD 목표(1분)의 경계에 있다. 한국 방문자 응답 속도에는 KV 콜드 조회와 통신사 라우팅이라는 두 가지 문제가 있다.

출시 전까지 dsites.kr을 스테이징으로 함께 쓴다. 출시 직전에 테스트 데이터를 지우고, 스테이징은 별도 존으로 옮긴다. 한 존에서 `*/*` 라우트는 Worker 하나에만 걸 수 있기 때문이다.

## 리소스

계정: Daniworks (`358a1b6caabcf91741109efca1ec0547`). 존 `dsites.kr`은 Free 플랜이고 Cloudflare for SaaS를 켰다.

| 종류 | 이름 | ID·위치 |
| --- | --- | --- |
| Worker | `sites-api-staging` | 라우트 `api.dsites.kr/*` |
| Worker | `sites-router-staging` | 라우트 `*/*` |
| D1 | `daniworks-sites-staging` | `fc09d755-f8b2-43e1-9bcf-55a00786d15a`, APAC, 읽기 복제 끔 |
| R2 | `daniworks-sites-staging` | APAC |
| KV | `sites-routes-staging` | `81f56d8264ab431ab7ca5da79add2496` |
| 시크릿 | `ADMIN_TOKEN` (api) | 값은 `apps/api/.dev.vars.staging`(gitignore)에만 있다 |

### 호스트·라우트

| 호스트 | DNS | Worker 라우트 | 용도 |
| --- | --- | --- | --- |
| `*.dsites.kr` | AAAA `100::`, 프록시 | `*/*` → router | 고객 서브도메인 |
| `connect.dsites.kr` | AAAA `100::`, 프록시 | (`*/*`에 포함) | SaaS fallback origin(활성) |
| `api.dsites.kr` | AAAA `100::`, 프록시 | `api.dsites.kr/*` → api | 플랫폼 API·프리뷰. `*/*`보다 구체적이라 우선 |
| `dsites.kr` | 없음 | (`*/*`에 포함) | 미정. 레코드를 만들면 라우터로 가서 404가 난다 |

## 배포 절차

`wrangler.toml`의 `[env.staging]`에 바인딩을 모두 다시 적었다(wrangler는 바인딩과 vars를 env로 상속하지 않는다). 로컬 개발 설정은 그대로다.

```bash
# 처음 한 번
wrangler d1 create daniworks-sites-staging
wrangler r2 bucket create daniworks-sites-staging
wrangler kv namespace create sites-routes-staging       # ID를 [env.staging]에 반영
(cd apps/api && wrangler secret put ADMIN_TOKEN --env staging)

# 배포 (빌드 → D1 원격 마이그레이션 → api → router)
pnpm deploy:staging

# 공용 에셋 업로드와 검증
API_URL=https://api.dsites.kr ADMIN_TOKEN=… node scripts/upload-shared.mjs
pnpm verify:staging                    # ADMIN_TOKEN이 없으면 apps/api/.dev.vars.staging에서 읽는다
REGIONS=1 pnpm verify:staging          # Globalping 프로브로 지역별 반영 시간도 잰다
```

### 수동으로 한 것과 막힌 지점

- wrangler OAuth 토큰에는 DNS 편집 권한과 `custom_hostnames` API 권한이 없다. DNS 레코드, fallback origin, 커스텀 호스트네임은 대시보드에서 만들었다. M2에서 `/custom_hostnames`를 apps/api에 붙이려면 존 한정 API 토큰(SSL and Certificates: Edit)이 필요하다.
- `*/*` 라우트를 배포하면 `You cannot use a wildcard host without Cloudflare for SaaS` (code 10022)가 났다. SaaS를 켠 직후에도 같은 오류가 났고, fallback origin이 **활성**이 된 뒤에 통과했다. 그 전까지는 `*.dsites.kr/*`를 임시로 썼다.
- SaaS 활성화(결제 수단 등록)는 운영자가 직접 했다. 유료 기능(ACM, Workers for Platforms)은 켜지 않았다.

## 결과

### 시나리오 (`scripts/verify-staging.mjs`)

두 번 실행해 18/18 모두 통과했다(`stg-mwmc19ni`, `stg-mwmc46r2`). 항목은 `verify:m1`과 같고, Host 헤더 트릭 없이 실제 도메인으로 요청한다. 공용 CSS가 `immutable`로 서빙되는지도 확인한다.

브라우저 검사는 이 머신에 Playwright가 없어 건너뛰었다(스크립트는 Playwright가 있으면 실행한다). 하이드레이션·콘솔 오류는 실제 도메인에서 확인하지 못했다.

### 응답 시간

측정 위치는 한국(KT 계열) 사무실 회선이다. 이 회선의 dsites.kr 요청은 ICN이 아니라 DFW·LAX·TXL·ARN 같은 해외 콜로로 들어갔다(아래 라우팅 참고). 그래서 아래 값에는 대륙 간 왕복이 들어 있다.

| 항목 | 1차 | 2차 |
| --- | --- | --- |
| 사이트 생성 (`POST /sites`) | 830 ms | 865 ms |
| v1 게시 (렌더 + R2 + KV) | 2,457 ms | 1,905 ms |
| v2 게시 | 2,149 ms | 2,033 ms |
| 롤백 (포인터만) | 1,556 ms | 1,754 ms |

- 구간 비교(같은 회선, TXL·ARN 콜로): `/health` TTFB 0.91초(네트워크와 TLS만), D1 읽기 1회 포함 `GET /sites/:id` 1.5초, 이미 렌더된 버전 재게시 2.0~3.8초.
- Worker는 먼 콜로에서 실행되고 D1·R2는 APAC에 있어서, D1 쿼리마다 대륙을 오간다. 운영자 API에만 해당하고 공개 사이트에는 영향이 없다. 국내 콜로에서 실행되면 짧아질 것으로 보이지만 확인하지 못했다.

### 게시·롤백 반영 시간

`waitFor`는 API 응답 직후부터 1초 간격으로 공개 주소를 다시 읽는다. 지역별 값은 Globalping HTTP 프로브(서울·도쿄·싱가포르·프랑크푸르트·버지니아)로 쟀다. 한 번에 3~5초가 걸리고 사이에 5초를 쉬므로, 해상도는 5~10초다. 괄호 안은 실제로 응답한 콜로다. 프로브 지역명과 콜로가 다른 경우는 통신사 라우팅 때문이다.

| 이벤트 | 측정 위치 | 1차 | 2차 |
| --- | --- | --- | --- |
| v1 첫 게시 | 측정 PC | 0.7초 (DFW) | **52.2초** |
| v2 게시 | 측정 PC | 0.6초 (DFW) | 4.1초 |
| v2 게시 | 프로브 5곳 | 모두 4.2초 이내 | 모두 7.6초 이내 |
| v1 롤백 | 측정 PC | 1.1초 (LAX) | 0.8초 |
| v1 롤백 | 서울 | 9.9초 (LAX) | 25.3초 (BOS) |
| v1 롤백 | 도쿄 | 58.8초 (NRT) | 53.1초 (NRT) |
| v1 롤백 | 싱가포르 | 58.8초 (SIN) | **60.2초** (SIN) |
| v1 롤백 | 프랑크푸르트 | 58.8초 (ARN) | **60.2초** (CDG) |
| v1 롤백 | 버지니아 | 3.2초 (DFW) | 16.8초 (DFW) |

해석:

- 라우터는 KV를 `cacheTtl: 60`으로 읽는다. 그 콜로가 최근 60초 안에 값을 읽었다면 이전 값을 최대 60초 동안 준다. 롤백 직전에 프로브가 v2를 읽어 둔 도쿄·싱가포르·유럽에서 53~60초가 나온 이유가 이것이다. 2차 v1 첫 게시가 52초 걸린 것도 같은 원리로, 게시 전에 읽은 "아직 게시 안 됨"(포인터 없음)이 캐시돼 있었기 때문이다.
- 아무도 읽지 않은 콜로는 몇 초 안에 새 값을 준다(v2 게시 지역 측정).
- 따라서 최악의 경우는 `cacheTtl` + 전파 시간이다. 실측 최대 60.2초로 PRD 목표(1분)의 경계에 있다. `cacheTtl`을 KV 최솟값인 30초로 낮추면 상한이 대략 절반이 된다. 대신 KV 읽기가 늘고 콜드 조회도 잦아진다(아래 참고). M2에서 결정한다.

### 한국 방문자 응답 속도

공개 사이트 HTML(약 수십 KiB)을 받는 데 걸린 시간이다. 원자료는 `evidence/staging/kr-probes.json`, `kr-cold-warm.json`에 있다(`evidence/`는 gitignore 대상).

통신사 라우팅 (Globalping 한국 프로브 10곳, 1회):

| 네트워크 | 콜로 | TTFB |
| --- | --- | --- |
| 데이터센터(Oracle·Microsoft·HostHatch·Vultr) 6곳 | ICN | 628~683 ms |
| KT (서울·천안) | CMH (미국 오하이오) | 983~1,146 ms |
| SK브로드밴드 (과천) | HKG | 1,031 ms |
| LG U+ (수원) | NRT | 190 ms |
| 측정 PC (KT 계열 사무실, 8회) | LAX·ATL·LHR | 706~1,818 ms |

같은 사무실 회선에서 `www.cloudflare.com`은 ICN, TTFB 40 ms였다. `daniworks.kr`(Free)은 ATL·LAX로 갔다. 이 플랫폼의 문제가 아니라 Free 플랜 존이 국내 통신사에서 어떻게 라우팅되는지의 문제로 보인다. 다른 플랜에서 달라지는지는 확인하지 못했다.

KV 콜드·웜 (같은 한국 프로브로 70초 쉬고 1회, 바로 이어서 2회):

| 콜로 | 콜드 | 웜 1 | 웜 2 |
| --- | --- | --- | --- |
| ICN (5곳) | 571~674 ms | 141~446 ms | 134~166 ms |
| LAX (KT 1곳) | 675 ms | 501 ms | 401 ms |

- ICN에서도 콜드 TTFB가 약 600ms이고, 이 가운데 약 450ms가 KV 조회다. 라우터는 `host:` → `site:` 두 키를 순서대로 읽고, 콜로 캐시에 없으면 각각 중앙 저장소까지 다녀온다.
- 방문이 하루 수십 건인 소상공인 사이트는 대부분 콜드로 맞는다. 후보: (1) `host:` 값에 게시 포인터를 함께 넣어 조회를 1회로 줄인다. (2) HTML을 Cache API로 콜로에 둔다. 두 안 모두 반영 시간과 함께 따져야 한다. M2에서 비교한다.

### 커스텀 호스트네임 (Cloudflare for SaaS)

- fallback origin `connect.dsites.kr`: 활성
- `*/*` 라우트: SaaS 트래픽을 받도록 배포됨
- 테스트 호스트네임 `dsites-test.daapp.net` (다른 Cloudflare 계정의 존, CNAME은 DNS 전용으로 일반 고객처럼): KV `host:dsites-test.daapp.net` → `stg-mwmc46r2` 사이트를 넣었다. 호스트네임 등록과 CNAME 추가는 진행 중이다.

## 정리할 것 (출시 전)

- 테스트 사이트: `stg-mwmc19ni`, `stg-mwmc46r2` (D1·R2·KV)
- KV `host:dsites-test.daapp.net`, 커스텀 호스트네임 `dsites-test.daapp.net`, `daapp.net` 존의 `dsites-test` CNAME
- 스테이징을 별도 존으로 옮길 때 `[env.staging]`의 `zone_name`·`BASE_DOMAIN`·라우트를 바꾸고, dsites.kr에는 production env를 새로 만든다.
- 콘솔 `BILLING_ACCOUNT`(입금 요청 안내문의 계좌)는 스테이징 임시값이다. 운영 env에는 실제 입금 계좌를 넣는다.

## 확인하지 못한 것

- 실제 도메인에서 브라우저 하이드레이션·콘솔 오류(Playwright 없음)
- 국내 콜로에서 실행될 때의 게시 API 응답 시간
- 통신 3사 모바일 회선 라우팅, 플랜별 국내 라우팅 차이
- 동시 게시 경합

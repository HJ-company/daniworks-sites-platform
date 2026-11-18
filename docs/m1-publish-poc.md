---
type: result
status: current
date: 2026-11-18
milestone: M1
---

# M1 게시 PoC 결과

결론: 사이트 설정을 D1에 버전으로 쌓고, 게시할 때 렌더해 R2에 올리고, KV 포인터로 공개·롤백하는 흐름이 로컬 workerd에서 동작한다. 라우터 Worker는 렌더 없이 서빙만 하며 번들이 gzip 1.4 KiB다. 다음은 M2(첫 고객)다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `packages/renderer` | 설정 검증(`validateSiteConfig`), 아이콘 허용 목록, HTML 렌더, 공용 에셋 빌드(`dist/shared/<해시>/`) |
| `apps/api` | D1 스키마(`migrations/0001_init.sql`), 사이트·버전 API, 프리뷰, 게시·롤백, 공용 에셋 업로드 |
| `apps/router` | Host → KV(사이트, 게시 버전) → R2. `robots.txt`·`sitemap.xml` 생성 |
| `scripts/upload-shared.mjs` | 공용 에셋을 API 경유로 R2에 업로드 |
| `scripts/verify-m1.mjs` | 전체 시나리오 검증 |

### 저장 구조

| 저장소 | 키 | 값 |
| --- | --- | --- |
| D1 | `sites`, `site_versions`, `domains` | 설정 원본과 버전 이력(추가만 함) |
| R2 | `sites/<siteId>/<versionId>/index.html` | 버전별 렌더 결과. 지우지 않음 |
| R2 | `shared/<에셋버전>/…` | CSS·JS·템플릿 사진. 내용 해시 경로라 영구 캐시 |
| KV | `host:<hostname>` | siteId |
| KV | `site:<siteId>` | `{ versionId, number, publishedAt }` |

### API

모든 경로는 `Authorization: Bearer <ADMIN_TOKEN>`이 필요하다. 예외는 `/health`, `/preview/:token`, `/_shared/*`다.

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/sites` | `{config, createdBy}` → 사이트 + v1 + `<slug>.<BASE_DOMAIN>` 연결 |
| GET | `/sites/:id` | 사이트와 버전 목록(프리뷰 토큰 포함) |
| POST | `/sites/:id/versions` | 새 버전(초안). 검증 실패 시 422, 저장 안 함. slug 변경 불가 |
| POST | `/sites/:id/publish` | `{versionId?}` 생략 시 최신 버전. 렌더(필요할 때만) → R2 → KV |
| POST | `/sites/:id/rollback` | `{versionId}` 게시된 적 있는 버전으로 포인터만 이동. 재렌더 없음 |
| GET | `/preview/:token` | 해당 버전을 즉석 렌더. `noindex`, 캐시 안 함 |
| PUT | `/admin/shared/<path>` | 공용 에셋 파일 업로드 |

## 재현

```bash
pnpm install
pnpm build                       # 공용 에셋 빌드 + src/generated/asset-version.ts 생성
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev:api                     # 터미널 1: D1 마이그레이션 + API :8788
pnpm dev:router                  # 터미널 2: 라우터 :8787
pnpm verify:m1                   # 터미널 3. 결과·캡처는 evidence/m1/
```

두 Worker는 `--persist-to .wrangler/state`로 로컬 D1·R2·KV를 공유한다. 공개 사이트는 `http://<slug>.localhost:8787/`이다.

## 결과 (wrangler 4.164 로컬 workerd, Chromium)

18건 모두 통과했다.

| 항목 | 결과 |
| --- | --- |
| 흐름 | 생성 → 프리뷰 → 게시 전 404 → v1 게시 → v2 초안(공개 안 됨) → v2 게시 → v1 롤백 → 미게시 버전 롤백 거부(409) |
| 검증 | 허용 목록 밖 아이콘 422, slug 변경 422, 실패 시 버전 미생성, 중복 slug 409, 무인증 401 |
| 라우터 | 연결 안 된 호스트 404, `robots.txt`·`sitemap.xml` 200 |
| 브라우저 | 모바일·데스크톱 하이드레이션, 콘솔 오류·실패 요청·외부 요청 0, 이미지 전부 로드 |
| 게시 API 응답 | 95~140 ms (렌더 + R2 + KV, 로컬) |
| 반영 | 로컬 10~20 ms. 배포 환경은 KV 전파로 최대 약 1분(PRD 목표) |
| 라우터 번들 | gzip 1.43 KiB (M0 렌더 Worker 691 KiB) |
| API 번들 | gzip 694 KiB (React·blocks 포함, 한도 이내) |

### 아이콘 허용 목록

- `src/icons/fa6.ts`(36개), `fi.ts`(16개)에 있는 아이콘만 쓸 수 있다. 저장할 때 검증하고, 클라이언트 번들은 esbuild 플러그인이 `react-icons/fa6`·`fi`를 이 모듈로 바꾼다.
- 아이콘 청크 크기(gzip): fa6 1,600 KiB 이상 → 7.9 KiB, fi 108 KiB → 1.3 KiB.
- 기본 클라이언트 JS는 gzip 94 KiB 그대로다(대부분 react-dom). 부분 하이드레이션은 M3 전에 검토한다.
- API Worker는 렌더를 위해 전체 아이콘 세트를 번들에 갖고 있다. 크기 한도 안이라 줄이지 않았다.

## M0에서 바뀐 것

- 라우터가 요청마다 렌더하던 M0 구조를 없앴다. 그래서 `scripts/verify-m0.mjs`도 지웠다. 렌더 검증은 `packages/renderer` 테스트와 `verify:m1`의 브라우저 검사가 맡는다.
- 공용 에셋 경로가 `/_assets/…`에서 `/_shared/<해시>/_assets/…`로 바뀌었다.

## 확인하지 않은 것

- 실제 Cloudflare 배포. KV 전파 시간, R2·D1 지연, 실제 도메인과 와일드카드 라우트는 배포해야 확인할 수 있다.
- Cloudflare for SaaS 커스텀 호스트네임 등록(M2)
- 동시 게시 경합(같은 사이트에 게시 요청이 겹칠 때)
- 사진 업로드(고객 사진을 R2에 올리고 seed에서 참조) — 지금은 템플릿 사진만 쓴다

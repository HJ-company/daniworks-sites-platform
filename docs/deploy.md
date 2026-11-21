---
type: guide
status: current
date: 2026-11-21
milestone: M5
---

# 배포 (스테이징·운영)

결론: Cloudflare에 스테이징과 운영 두 환경을 둔다. main에 push하면 스테이징이 배포되고, 운영은 릴리즈 태그나 수동 실행 뒤 승인을 받아 배포된다. 두 경로 모두 GitHub Actions가 `scripts/deploy.sh <환경>`을 실행한다. M1 스테이징 실측 결과는 [스테이징 배포(M1)](staging-deploy.md)에 남아 있다.

## 환경

| | 스테이징 | 운영 |
| --- | --- | --- |
| 공개 사이트 | `<slug>.staging.daniworks.kr` | `<slug>.dsites.kr`, 고객 도메인(for SaaS) |
| 시안 링크 | `staging.daniworks.kr/preview/<토큰>` | `dsites.kr/preview/<토큰>` |
| api·MCP | `api-staging.dsites.kr` (`/mcp`) | `api.dsites.kr` (`/mcp`) |
| 콘솔 | `dsites-console-staging.daniworks.kr` | `dsites-console.daniworks.kr` |
| Worker | `sites-{api,router,console}-staging` | `sites-{api,router,console}-production` |
| D1 | `daniworks-sites-staging` (`fc09d755-…`) | `daniworks-sites-production` (`04157951-…`) |
| R2 | `daniworks-sites-staging` | `daniworks-sites-production` |
| KV | `sites-routes-staging` (`81f56d82…`) | `sites-routes-production` (`1f7ad9d8…`) |
| Authentik 애플리케이션 | `dsites-console-staging`, `dsites-mcp-staging` | `dsites-console`, `dsites-mcp` |
| 배포 | main push (`deploy-staging.yml`) | `v*` 태그 또는 수동 실행 → 승인 (`deploy-production.yml`) |

모든 리소스는 Daniworks 계정(`358a1b6caabcf91741109efca1ec0547`)에 있다. 설정 값은 각 앱의 `wrangler.toml` `[env.staging]`·`[env.production]`이 기준이다. 최상위 설정은 로컬 개발용이다.

공개 사이트는 존을 나눴다. 한 존에서 `*/*` 라우트는 Worker 하나에만 걸 수 있는데, 운영 router가 dsites.kr의 `*/*`를 쓴다(고객 도메인 트래픽이 이 라우트로 들어온다). 그래서 스테이징 router는 daniworks.kr 존에 `staging.daniworks.kr/*`와 `*.staging.daniworks.kr/*`로만 붙는다. api는 두 환경 모두 dsites.kr에 있다. `api.dsites.kr/*`와 `api-staging.dsites.kr/*`는 `*/*`보다 구체적이라 그쪽이 우선한다.

주의: 실측해 보니 스테이징 router의 `*.staging.daniworks.kr/*`가 문서와 달리 `staging.daniworks.kr`으로 끝나는 모든 호스트(`abcstaging.daniworks.kr`, `dsites-console-staging.daniworks.kr`)를 잡았다(2026-11-21). 그래서 콘솔은 Custom Domain에 더해 같은 호스트의 정확한 라우트를 둔다(더 구체적인 라우트가 이기고, 라우트는 Custom Domain보다 우선한다). daniworks.kr에 이름이 `staging`으로 끝나는 호스트를 새로 만들 때도 같은 처리가 필요하다.

`<slug>.staging.daniworks.kr`은 2단계 서브도메인이라 Universal SSL이 덮지 못한다. daniworks.kr의 ACM(Total TLS 또는 Advanced 인증서)으로 `*.staging.daniworks.kr` 인증서를 둔다.

## 배포 흐름

`scripts/deploy.sh staging|production`이 하는 일:

1. 빌드: 렌더러(공용 CSS·JS·템플릿 사진), 콘솔 SPA
2. D1 원격 마이그레이션. 새 api 코드보다 먼저 돈다. 이전 api가 잠시 새 스키마에서 돌아가므로 마이그레이션은 더하기만 한다(삭제·이름 변경 금지).
3. 공용 자산 업로드(api의 `/admin/shared`, `ADMIN_TOKEN`). 새 api는 자기 자산 버전이 R2에 없으면 게시·시안 렌더를 거부하므로, 지금 떠 있는 api로 먼저 올린다. 버전 경로라 게시된 사이트가 쓰는 파일은 바뀌지 않는다. api가 아직 없는 첫 배포에서는 api 배포 직후에 올린다.
4. api → router → console 배포. router와 console이 api에 바인딩돼 있어 api가 먼저다.
5. `/health` 확인

GitHub Actions(`deploy.yml`, 두 워크플로가 함께 씀)는 배포 전에 대상 커밋이 main에 있는지 확인하고 `pnpm build && pnpm check-types && pnpm test`를 돌린다. 같은 환경의 배포는 한 번에 하나씩 돌고, 뒤에 온 배포는 앞 배포가 끝나기를 기다린다(마이그레이션 도중에 끊지 않는다).

운영 배포:

```bash
git tag v2026.11.21 && git push origin v2026.11.21   # 태그: 그 커밋을 배포
# 또는 Actions → deploy-production → Run workflow → ref(기본 main)
```

어느 쪽이든 `production` Environment의 승인자가 승인해야 진행된다. 롤백은 이전 태그로 수동 실행을 다시 하거나, 급하면 `wrangler rollback --env production`(Worker만, D1은 그대로)을 쓴다.

로컬에서 직접 배포할 때는 wrangler 로그인 상태에서 `pnpm deploy:staging`을 실행한다. `ADMIN_TOKEN`은 환경 변수나 `apps/api/.dev.vars.<환경>`(gitignore)에서 읽는다.

## 처음 한 번 할 일

### Cloudflare

- [ ] daniworks.kr DNS: `staging`, `*.staging`을 `AAAA 100::`(프록시)로 만든다.
- [ ] daniworks.kr 인증서: Total TLS를 켜거나, `staging.daniworks.kr`·`*.staging.daniworks.kr`을 넣은 Advanced 인증서를 발급한다. 확인: `openssl s_client -connect staging.daniworks.kr:443 -servername foo.staging.daniworks.kr`
- [ ] Turnstile 위젯: 허용 호스트에 `api-staging.dsites.kr`·`api.dsites.kr`(문의 폼 프레임 호스트)을 넣고, 사이트 키를 각 env의 `TURNSTILE_SITE_KEY`에 넣는다.
- [ ] Email Sending: dsites.kr 발신 활성화(`wrangler email sending enable`).
- [ ] CI용 계정 API 토큰: "Edit Cloudflare Workers" 템플릿 + Account D1 Edit. Zone Workers Routes Edit는 dsites.kr과 daniworks.kr 두 존에 준다(콘솔 Custom Domain과 라우트).

### Authentik

애플리케이션 4개(애플리케이션마다 issuer가 다르다). 설정은 [관리자 콘솔 4절](admin-console.md#mcp-인증)과 같다.

| 애플리케이션 slug | Redirect URI |
| --- | --- |
| `dsites-console-staging` | `https://dsites-console-staging.daniworks.kr/auth/callback` |
| `dsites-mcp-staging` | Claude·ChatGPT·mcp-inspector 콜백 |
| `dsites-console` | `https://dsites-console.daniworks.kr/auth/callback` |
| `dsites-mcp` | Claude·ChatGPT·mcp-inspector 콜백 |

### Worker 시크릿 (환경마다)

```bash
cd apps/api && for s in ADMIN_TOKEN TURNSTILE_SECRET HASH_PEPPER CF_ZONE_ID CF_API_TOKEN OPENAI_API_KEY; do npx wrangler secret put $s --env <환경>; done
cd apps/console && for s in OIDC_CLIENT_SECRET SESSION_SECRET; do npx wrangler secret put $s --env <환경>; done
```

- `CF_ZONE_ID`는 두 환경 모두 dsites.kr(고객 도메인이 dsites.kr의 for SaaS에 붙는다). `CF_API_TOKEN`은 dsites.kr 한정 SSL and Certificates: Edit.
- `SESSION_SECRET`은 32자 이상 무작위 문자열.
- `OPENAI_IMAGE_MODEL`은 모델이 정해지면 env vars에 넣는다.
- 운영 콘솔 `BILLING_ACCOUNT`는 비어 있다(콘솔이 경고하고 안내문에서 계좌를 뺀다). 오픈 전에 실제 계좌를 넣는다.

### GitHub (`HJ-company/daniworks-sites-platform`)

- [ ] Environments `staging`, `production`을 만든다. `production`에는 Required reviewers를 지정하고, 배포 브랜치·태그를 `main`과 `v*`로 제한한다.
- [ ] 각 Environment에 시크릿 `CLOUDFLARE_API_TOKEN`(CI용 토큰), `ADMIN_TOKEN`(그 환경 api의 값)을 넣는다.

## 스테이징에서 고객 도메인 시험

고객 도메인은 운영과 같은 dsites.kr for SaaS에 등록된다(스테이징 api도 `CF_ZONE_ID`가 dsites.kr이다). 그 트래픽은 dsites.kr의 `*/*`를 타고 운영 router로 간다. 스테이징에서 시험하려면 시험용 호스트네임에만 dsites.kr 존에서 `sites-router-staging`으로 가는 라우트(예: `dsites-test.daapp.net/*`)를 대시보드에서 따로 건다. 고객 쪽 레코드가 DNS 전용(회색 구름)일 때만 이 라우트가 맞는다.

## 전환 메모 (2026-11-21)

M1 때의 스테이징(`sites-api-staging`·`sites-router-staging`)은 `api.dsites.kr/*`와 dsites.kr `*/*`에 붙어 있었다. 이 구성으로 스테이징을 다시 배포하면 두 라우트에서 빠지고, 운영을 처음 배포할 때까지 dsites.kr은 비어 있다. **스테이징을 먼저 배포한다.** 그 전에는 `api.dsites.kr`을 예전 스테이징 api가 받으므로, 운영 배포가 공용 자산을 그쪽으로 올리려 한다(두 환경의 `ADMIN_TOKEN`이 다르면 업로드가 거부돼 배포가 멈춘다). 예전 스테이징에 만든 테스트 사이트(`stg-mwmc19ni`, `stg-mwmc46r2`)와 테스트 호스트네임 `dsites-test.daapp.net`은 스테이징 D1·KV에 그대로 남는다.

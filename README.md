# daniworks-sites-platform

스타터 홈페이지 플랫폼. 사이트 설정(JSON)을 D1에 버전으로 쌓고, 게시할 때 HTML로 렌더해 R2에 올린다. 라우터 Worker가 접속 도메인을 보고 해당 사이트 파일을 서빙한다.

- 요구사항: [docs/prd.md](docs/prd.md)
- 결과: [M0 렌더 PoC](docs/m0-render-poc.md), [M1 게시 PoC](docs/m1-publish-poc.md), [스테이징 배포](docs/staging-deploy.md), [M2 첫 고객](docs/m2-first-customer.md), [M3 운영](docs/m3-operations.md)

```bash
pnpm install
pnpm build                                        # 공용 CSS·JS·템플릿 사진
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev:api                                      # API :8788 (D1 마이그레이션 포함)
pnpm dev:router                                   # 공개 사이트 http://<slug>.localhost:8787
pnpm verify:m1                                    # 전체 시나리오 검증
pnpm test && pnpm check-types
```

### Docker 로컬 검증

호스트 node_modules와 무관하게 Linux 컨테이너에서 Workers·브라우저 검증을 돌린다. 단계마다 이 경로로 확인한다.

```bash
docker compose up -d --build                      # api :8788, router :8787, 콘솔 :8789, Authentik 목업 :8791, mailpit :8025, cf-mock :8790
docker compose run --rm verify node scripts/verify-all.mjs  # 전체 검증. 단계별: verify-m2-<단계>.mjs, 결과는 evidence/<단계>/
docker compose down -v                            # 로컬 D1·R2·KV 상태까지 지움
```

`verify`는 workers 컨테이너의 네트워크를 함께 써서, 스크립트가 `127.0.0.1`·`*.localhost`로 Workers에 닿는다.

- 운영자 콘솔: http://127.0.0.1:8789 → Authentik 목업(:8791) 로그인 화면에서 `kim`·`lee`(운영자), `guest`(권한 없음), `many`(그룹이 많은 운영자) 중 선택
- MCP: `http://127.0.0.1:8788/mcp`. 사람은 OAuth(목업 클라이언트 `dsites-mcp`/`dev-mcp-secret`, mcp-inspector 콜백 `http://localhost:6274/oauth/callback`), 스크립트는 `Authorization: Bearer dev-admin-token`
- 시안 링크: http://localhost:8787/preview/<토큰> (콘솔 사이트 개요에서 발급)
- 메일 확인: http://127.0.0.1:8025 (Mailpit)

### 운영 명령

```bash
API_URL=... ADMIN_TOKEN=... node scripts/republish-all.mjs [--apply]               # 렌더러 변경 뒤 전체 재게시(시각 비교)
API_URL=... ADMIN_TOKEN=... node scripts/handoff-to-strapi.mjs --site=<slug> --into=<프로젝트>  # AI 홈페이지 전환
```

스테이징(`*.dsites.kr`, `api.dsites.kr`)은 [docs/staging-deploy.md](docs/staging-deploy.md)를 따른다.

```bash
pnpm deploy:staging                               # 빌드 → D1 원격 마이그레이션 → api → router
pnpm verify:staging                               # 실제 도메인에서 전체 시나리오
```

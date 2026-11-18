# daniworks-sites-platform

스타터 홈페이지 플랫폼. 사이트 설정(JSON)을 D1에 버전으로 쌓고, 게시할 때 HTML로 렌더해 R2에 올린다. 라우터 Worker가 접속 도메인을 보고 해당 사이트 파일을 서빙한다.

- 요구사항: [docs/prd.md](docs/prd.md)
- 결과: [M0 렌더 PoC](docs/m0-render-poc.md), [M1 게시 PoC](docs/m1-publish-poc.md)

```bash
pnpm install
pnpm build                                        # 공용 CSS·JS·템플릿 사진
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev:api                                      # API :8788 (D1 마이그레이션 포함)
pnpm dev:router                                   # 공개 사이트 http://<slug>.localhost:8787
pnpm verify:m1                                    # 전체 시나리오 검증
pnpm test && pnpm check-types
```

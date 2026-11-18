# daniworks-sites-platform

스타터 홈페이지 플랫폼. 사이트 설정(JSON)을 DB에 두고, 게시 시점에 HTML로 렌더해 Cloudflare에서 서빙한다.

- 요구사항: [docs/prd.md](docs/prd.md)
- M0 렌더 PoC 결과: [docs/m0-render-poc.md](docs/m0-render-poc.md)

```bash
pnpm install
pnpm --filter @sites/renderer build   # 공용 CSS·JS·템플릿 사진
pnpm dev                              # http://127.0.0.1:8787/sample
pnpm verify:m0                        # 브라우저 검증 (dev 실행 중)
```

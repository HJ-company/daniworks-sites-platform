---
type: result
status: current
date: 2026-11-18
milestone: M0
---

# M0 렌더 PoC 결과

결론: `@dani-builder/blocks`는 Worker(workerd) 안에서 렌더되고, 브라우저에서 하이드레이션까지 정상 동작한다. PRD 8장 1순위 위험은 해소됐다. M1(게시 시점 렌더 → R2)로 진행한다.

## 구성

- `packages/renderer`: `SiteConfig` → `createTemplatePreview` → `SiteShell` + `BlockRenderer` → `renderToReadableStream` → HTML 문서. 같은 `SiteView`를 클라이언트에서 `hydrateRoot`로 하이드레이션한다.
- 공용 에셋(템플릿 버전마다 한 번 빌드): Tailwind CSS, 클라이언트 번들(esbuild, 코드 분할), 템플릿 사진.
- `apps/router`: M0 전용. 요청마다 샘플 사이트 3개(`sample`, `logistics`, `ceramics`)를 렌더한다. M1에서 렌더는 게시 시점으로 옮기고, 이 Worker는 R2 서빙만 한다.
- 의존성: `@dani-builder/blocks` 2.2.0, `site-templates` 0.8.0, `strapi-client` 2.5.0, React 19.3.

## 재현 (M0 당시)

M1에서 라우터가 서빙 전용으로 바뀌어 아래 명령과 `verify-m0`는 더 이상 없다. 현재 재현은 [M1 결과](m1-publish-poc.md)를 따른다.

```bash
pnpm install
pnpm --filter @sites/renderer build
pnpm dev                 # wrangler dev, http://127.0.0.1:8787/sample
pnpm verify:m0           # 다른 터미널에서. 결과·캡처는 evidence/m0/
```

## 결과 (wrangler 4.164 로컬 workerd, Chromium)

| 항목 | 결과 |
| --- | --- |
| 브라우저 검사 | 3개 사이트 × 모바일·데스크톱 6건 모두 통과 |
| 검사 내용 | HTTP 200, 하이드레이션, 콘솔 오류 0, 실패 요청 0, 외부 요청 0, 스크롤 후 이미지 전부 로드, 모바일 메뉴 토글 동작 |
| 렌더 시간 | 36~107ms/요청 (로컬 측정) |
| HTML | 20~26 KiB (gzip 약 5 KiB) |
| CSS | 52.6 KiB (gzip 11 KiB) |
| 클라이언트 JS | 308 KiB (gzip 94 KiB). 대부분 react-dom |
| Worker 번들 | 2,987 KiB (gzip 691 KiB). 무료 한도 3 MiB, 유료 10 MiB 이내 |

## 발견한 것

1. **아이콘 세트가 크다.** blocks가 `react-icons/fa6`(1.6 MiB), `fi`(108 KiB)를 지연 로드한다. 클라이언트는 코드 분할로 쓸 때만 받지만, 아이콘을 하나라도 쓰면 세트 전체를 받는다. 업종 템플릿에서 아이콘을 쓰면 builder 쪽에서 아이콘 단위 분할이 필요하다.
2. **하이드레이션 비용.** 원페이지에 JS 94 KiB(gzip)는 PRD 성능 목표(모바일 Lighthouse 90)에 부담이 될 수 있다. 인터랙션이 필요한 블록만 부분 하이드레이션하는 방안을 M3 전에 검토한다. FAQ는 네이티브 `<details>`라 JS가 없어도 동작한다.
3. **lazy 이미지.** 화면 밖 이미지는 스크롤해야 로드된다. 정상 동작이지만, 캡처·리포트 자동화는 스크롤 후 찍어야 한다.
4. **문의 폼.** blocks 2.x의 `InquiryFormBlock`은 폼 렌더러 컨텍스트가 필요하다. M0는 자리표시로 대체했고, M2에서 공용 문의 Worker와 연결한다.
5. **렌더 시간 측정.** 배포된 Workers에서는 I/O 전까지 `Date.now()`가 멈추므로 `server-timing` 값을 믿을 수 없다. 운영 측정은 게시 job 단위로 한다.

## 확인하지 않은 것

- 실제 Cloudflare에 배포한 상태의 렌더(로컬 workerd만 확인)
- 고객 seed(`SiteConfig.seed`)를 넣은 렌더와 검증 실패(422) 경로
- 웹폰트(M0는 시스템 폰트)
- Lighthouse 점수

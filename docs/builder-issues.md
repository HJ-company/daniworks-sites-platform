# Builder 이슈 초안

스타터 플랫폼에서 발견한 `@dani-builder/*` 결함·요청. 빌더 저장소(`~/projects/daniworks-builder-v2`)에 올리기 전 초안이다. 플랫폼은 우회하고 있다.

## 1. CTA `card-*` variant: accent·dark 테마에서 카드 안 보조 버튼이 보이지 않음

- 버전: `@dani-builder/blocks` 2.2.0
- 재현: `blocks.cta`, `variant: "card-centered"`, `section.theme: "accent"`, `secondaryLink` 지정
- 결과: 카드 배경은 밝은데, 버튼은 섹션 테마 기준(`isDarkTheme`)으로 흰 글씨·흰 테두리를 쓴다. 보조 버튼이 거의 보이지 않는다.
- 기대: 카드 variant는 카드 배경 기준으로 버튼 색을 정한다.
- 근거: `packages/blocks/src/blocks/cta.tsx`의 `CardCta`와 `isDarkTheme`. 플랫폼 캡처는 `evidence/m2-template/lesson-mobile.png`(수정 전).
- 플랫폼 우회: `service-local` 템플릿은 `inline-centered`를 쓴다.

## 2. features 설명의 줄바꿈 (참고)

- `MarkdownText`는 빈 줄로 나뉜 덩어리만 문단으로 만들고, 한 줄 바꿈은 이어 붙인다. 의도된 동작으로 보이나 문서에 없다. 플랫폼은 `\n\n`으로 문단을 나눈다.

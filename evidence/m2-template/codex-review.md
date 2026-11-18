# 2-1·2-2 (설정 v2, service-local 템플릿) codex review

명령: `codex review --uncommitted` (codex-cli 0.167.0), 2회

## 1차

| 등급 | 지적 | 처리 |
| --- | --- | --- |
| P1 | 문의 폼이 `/api/inquiry`로 보내지만 엔드포인트가 아직 없음 | **보류**: 계획상 2-5에서 구현한다. 이 브랜치는 그전까지 배포하지 않는다. 프리뷰에서는 전송을 막았다 |
| P2 | 프리뷰 링크를 HTML 문자열로만 바꿔 하이드레이션 데이터와 어긋남 | 반영: 렌더러 `linkPrefix` 옵션과 `RenderContext`로 SSR·하이드레이션 양쪽에 같은 링크를 넣음. 문자열 치환 제거 |
| P2 | v1 설정의 `templateId` 검증이 빠짐(없으면 500) | 반영: 검증 복원, 테스트 추가 |

## 2차

| 등급 | 지적 | 처리 |
| --- | --- | --- |
| P1 | 문의 엔드포인트 없음(1차와 같음) | 보류(위와 같음) |
| P2 | 0507 안심번호(4자리 국번)를 거부함 | 반영: 정규식 수정, 하이픈 있음·없음 테스트 추가 |

## 검증

- `pnpm test` 38건, `pnpm check-types` 통과
- Docker `verify-m2-template.mjs` 28/28 (Lighthouse 모바일 성능 100, LCP 1.3초), `verify-m1.mjs` 18/18

# 3-1 블로그 최신 글 codex review

명령: `codex review --uncommitted`, 3회. 마지막 회차는 지적 없음.

| 회차 | 등급 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | P2 | 블로그 주소를 바꿔도 이전 블로그 글이 캐시에 남아 보임 | 주소 변경 시 KV 캐시 삭제 |
| 2 | P2 | 수집 중 주소가 바뀌면 늦게 끝난 수집이 옛 글을 쓰고 새 주소를 수집 완료로 표시 | 수집 결과를 가져온 주소에 묶음(쓰기 전 재확인, 조건부 갱신, 어긋나면 다시 대기) |
| 2 | P2 | 엣지 캐시(300초)가 주소 변경을 늦게 반영 | 자리표시자(`data-blog-feed`)와 캐시 피드(`source`)에 블로그 주소, 같을 때만 표시 |
| 3 | - | 지적 없음 | - |

## 설계

- api cron(5분)이 3시간 지난 피드를 갱신해 KV `blog:<siteId>`에 저장. 게시·롤백 때 `blog_feeds`를 맞춤.
- 라우터가 홈 페이지 응답을 HTMLRewriter로 고쳐 `[data-blog-feed]`에 카드 HTML을 넣음. 글이 올라와도 재게시가 필요 없고, 글이 HTML에 있어 검색엔진도 읽는다. 내용이 바뀌므로 ETag 제거.
- 하이드레이션: 자리표시자는 `dangerouslySetInnerHTML`이라 React가 내용을 비교하지 않아 카드가 유지된다(브라우저 검증).
- 네이버 이미지는 `referrerpolicy="no-referrer"`(요청에 Referer 없음을 검증).
- 라우터는 렌더러의 순수 모듈(`@sites/renderer/blog`)만 가져와 번들 gzip 3.5KB.

## 검증 (Docker)

- `verify-m3-blog.mjs` 12/12(LIVE=1에서 실제 네이버 RSS 파싱 포함): 게시 직후 빈 섹션, cron 수집 후 카드 3개(재게시 없이), 링크·날짜·이스케이프, ETag 제거, privacy 미재작성, 하이드레이션 후 유지, Referer 없음, 실패 시 유지, 블로그 변경 시 즉시 제거, 블로그 제거 시 정리
- 회귀: M1, 템플릿, 라우터

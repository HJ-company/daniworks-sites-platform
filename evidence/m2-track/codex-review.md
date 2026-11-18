# 2-6 측정 codex review

명령: `codex review --uncommitted`, 1회. 지적 없음.

## 설계 메모

- 비콘(`sendBeacon`, text/plain)은 라우터 `/api/track` → api `PublicApi.track` RPC → D1 `metrics_daily`(한국 날짜 기준) upsert. 라우터는 항상 204로 답하고 `waitUntil`로 넘겨 페이지를 기다리게 하지 않는다.
- 클릭 분류는 문서 전체의 위임 리스너 하나가 맡는다(`data-track` 우선, 없으면 링크 목적지: tel, 카카오, 네이버 예약, 지도, `#inquiry`). 하단 연락 바와 블록 링크를 같은 기준으로 센다.
- 집계하지 않음: 봇 UA(검색·미리보기 크롤러, headless, Lighthouse), 프리뷰, 서버 전용 이벤트(`inquiry`), 정지·해지 사이트. 인앱 브라우저(카카오톡, 네이버, 다음)는 사람으로 센다.
- 알려진 한계: 같은 방문자가 비콘을 반복해 보내 수치를 부풀리는 것은 막지 않는다. 분기 리포트 용도라 허용하고, 문제가 되면 방문자 해시 기준 일 단위 중복 제거를 넣는다.

## 검증 (Docker)

- `verify-m2-track.mjs` 8/8: 실제 모바일 UA로 조회 1회와 클릭 5종이 각 1씩 집계, headless·프리뷰·잘못된 이벤트·봇·정지 사이트는 제외, 리포트 API
- api 단위 테스트 50건(UA 판별, 한국 날짜), renderer 28건(링크 분류)
- 회귀: M1 18/18, 템플릿(Lighthouse 포함) 28/28, 문의 24/24, 라우터 13/13

# 2-5 문의 codex review

명령: `codex review --uncommitted`, 3회. 마지막 회차는 지적 없음.

| 회차 | 등급 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | P2 | Turnstile을 나중에 켜면 이미 렌더된 버전은 다시 게시해도 프레임 없는 HTML이 남아 모든 문의가 403 | 반영: 렌더 캐시 키에 origin과 Turnstile 프레임 URL을 포함 |
| 1 | P2 | 동시 제출이 COUNT 검사를 함께 통과해 한도를 넘음 | 반영: 한도 검사와 저장을 `INSERT … SELECT … WHERE` 한 문장으로. 동시 12건 시험에서 정확히 5건 저장 |
| 2 | P2 | CSV가 최신 200건만 조용히 내보냄 | 반영: 목록은 keyset 페이지네이션(`before`), CSV는 전체를 페이지 단위로 수집 |
| 2 | P2 | `MAIL_MODE=off`인데 알림을 sent로 기록 | 반영: 발송하지 않으면 skipped |
| 3 | - | 지적 없음 | - |

## 설계 메모

- Turnstile 위젯은 허용 호스트 수가 제한되어 고객 커스텀 도메인마다 둘 수 없다. 위젯은 api 호스트의 `/turnstile-frame`에서 띄우고 토큰을 postMessage로 넘긴다. 프레임은 폼에 입력을 시작할 때만 불러와 페이지 성능에 영향이 없다(Lighthouse 측정 대상 아님). 실제 위젯이 iframe 호스트 기준으로 검증되는지는 스테이징에서 확인해야 한다.
- 문의 제출은 라우터가 Host로 사이트를 판별한 뒤 api의 `PublicApi` RPC로 넘긴다. HTTP로는 닿지 않아 임의 siteId로 제출할 수 없다.

## 검증 (Docker)

- `verify-m2-inquiry.mjs` 24/24: 브라우저 폼(Turnstile 테스트 키) → D1 → Mailpit 메일 → 목록·페이지네이션·CSV, 허니팟·2초 미만·토큰 없음·형식 오류·크기·메서드, 방문자 한도(순차·동시), IP 해시만 저장, 지표, 정지 사이트
- api 단위 테스트 36건, 회귀: M1 18/18, 템플릿 28/28, 라우터 13/13, 업로드 26/26

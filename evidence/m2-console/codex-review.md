# 2-9 운영자 콘솔 codex review

명령: `codex review --uncommitted`, 2회. 마지막 회차는 지적 없음.

| 회차 | 등급 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | P2 | "더 보기"로 불러온 문의가 DataGrid 내부 페이지에 숨어 볼 수 없음 | 페이지 이동 컨트롤 표시(25/50/100) |
| 1 | P2 | 저장 중 입력한 편집이 저장 후 재조회로 덮여 사라짐 | 서버 값은 편집되지 않은 상태일 때만 반영, 저장 중 편집기 읽기 전용 |
| 2 | - | 지적 없음 | - |

## 구조

- Vite + React CSR + MUI 9(DataGrid, Tabs, Grid `size`, `slotProps`), React Router 8, TanStack Query, CodeMirror(JSON)
- 콘솔 Worker가 빌드된 SPA와 `/api/*`를 서빙한다. `/api`는 서비스 바인딩으로 api에 넘기며 관리자 토큰을 서버에서 붙이고, 브라우저의 Authorization·Cookie는 버린다. 브라우저에는 자격 증명이 없다.
- 운영 환경은 Cloudflare Access 뒤(admin.dsites.kr)에 두고, Worker가 Access JWT(issuer, audience)를 다시 검증한다. Access 설정이 없으면 로컬 플래그가 있을 때만 응답한다.
- 사진은 브라우저에서 EXIF 방향을 적용해 긴 변 1600px JPEG로 줄여 올린다(Worker 3MP 한도).
- 프리뷰 링크는 api의 절대 URL(자산이 api 출처에서 로드됨).
- 무거운 탭(CodeMirror, DataGrid)은 지연 로드. 첫 화면 JS 388KB(gzip 121KB).

## 검증 (Docker)

- `verify-m2-console.mjs` 20/20(Playwright): 목록, 토큰 미노출, 새 사이트(시작 설정), 업체 정보 폼·JSON 편집, 검증 오류 경로·통과, 초안 저장, 게시·롤백(라우터 확인), 프리뷰, 12MP 원본 브라우저 축소 업로드(1600×1200), 도메인 등록·안내·삭제, 문의 CSV, 통계, 공개 정지·재개, api 직접 호출 401
- 콘솔 Worker 단위 테스트 5건(Access 없음·JWT 없음·위조 JWT 403, 토큰 교체 프록시, SPA)

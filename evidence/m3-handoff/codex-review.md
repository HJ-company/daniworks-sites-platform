# 3-6 AI 홈페이지 전환 codex review

명령: `codex review --uncommitted`, 2회. 둘 다 지적 없음.

## 내용

- `GET /sites/:id/template-seed[?versionId=]`: 사이트 콘텐츠를 빌더 `TemplateSeed`로(business-basic, 원페이지 + 개인정보처리방침), 업로드 사진은 절대 URL.
- `scripts/handoff-to-strapi.mjs --site= --into=<프로젝트>`: create-daniworks-app으로 만든 프로젝트의 `template-data/seed.json`(`{ seed, colors }`)과 `template-data/assets/`를 사이트 내용으로 바꾼다. 이후 `pnpm --filter cms template:import`(새 CMS만).
- builder-v2는 수정하지 않았다. importer가 읽는 형식(seed.json, 자산 파일명, 문의 폼 slug `contact`·동의 버전 기본값)과 맞춘다.

## 검증 (Docker)

- `verify-m3-handoff.mjs` 8/8: 게시 전 409, 형식·선택·출처, 빌더 seed 계약 검증(importer와 같은 검사), 페이지·상호, 사진 URL 내려받기, 예전 버전, 프로젝트 배치(파일명 일치, 이전 자산 정리), 쓴 seed 재검증
- 실제 Strapi에 가져오는 것(`template:import`)은 빌더 프로젝트를 띄워야 하므로 확인하지 않았다.

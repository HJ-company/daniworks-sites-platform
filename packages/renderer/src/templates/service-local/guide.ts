/**
 * Authoring guide for AI agents and operators, served by the MCP `template_get` tool.
 * Keep it in sync with packages/schema/src/site-config.ts (limits) and compile.ts (sections).
 */
export const serviceLocalGuide = `# service-local 템플릿 작성 지침

레슨·교육(학원, 레슨, 아카데미)과 출장 서비스(청소, 설비, 하수도, 공사)를 위한 원페이지다.
블록 종류·순서·디자인은 템플릿이 정한다. 작성자는 config.business와 config.content만 채운다.

## 1. preset 고르기

- lesson: 손님이 찾아와 배우는 곳. 수업 시간·장소·레벨이 핵심이다.
- field: 직접 찾아가서 일하는 곳. 출장 지역·진행 순서·견적이 핵심이다.

## 2. 자료에서 뽑을 것 (블로그·플레이스·인스타)

| 필드 | 어디서 | 메모 |
| --- | --- | --- |
| business.name | 플레이스 상호 | 블로그 닉네임이 아니라 정식 상호 |
| business.phone | 플레이스 전화 | 0507 안심번호도 그대로 쓴다 |
| business.kakaoUrl | 블로그·플레이스의 카카오 채널·오픈채팅 링크 | pf.kakao.com 또는 open.kakao.com만 |
| business.bookingUrl | 네이버 예약 링크 | 있을 때만 |
| business.address, mapUrl | 플레이스 주소, 지도 공유 링크 | 출장형이면 생략 가능 |
| business.hours | 플레이스 영업시간, 블로그 시간표 | label은 요일, value는 시간·장소 |
| business.serviceAreas | 출장 지역, 수업 장소 | 짧게 여러 개 |
| business.representative | 사업자 정보 | 개인정보처리방침에 들어간다. 모르면 운영자에게 확인 |
| content.services | 블로그 소개글, 메뉴·가격표 | 2~8개, 손님이 고르는 단위 |
| content.process | 진행 방법을 설명한 글 | 2~6단계 |
| content.gallery | 현장·작업 사진이 있는 글 | 사진은 asset_upload로 올린 m: 키 |
| content.testimonials | 후기 글, 플레이스 리뷰 | 원문 의미를 바꾸지 말 것. 이름은 '노원구 고객'처럼 익명 |
| content.faqs | 자주 받는 질문, 공지 | AI 답변에 인용되기 좋은 짧은 문답 |

## 3. 쓰는 원칙

- 사실만 쓴다. 자료에 없는 수치(경력 연수, 고객 수, 수상)를 만들지 않는다.
- '최고', '1위', '100% 보장' 같은 최상급·보장 표현은 쓰지 않는다.
- 문장은 짧게. hero.heading은 줄바꿈(\\n) 포함 2줄 이내.
- 지역명과 서비스명을 자연스럽게 넣는다(예: '노원구 입주청소'). 같은 단어를 반복해 채우지 않는다.
- 연락처·가격은 자료와 정확히 같아야 한다. 확인되지 않으면 비우고 운영자 메모로 남긴다.

## 4. 사진

- 사진이 없으면 t:<샘플> 키를 임시로 쓰고, 시안 단계에서 고객 사진으로 바꾼다.
- 업로드 사진은 asset_upload 결과의 key·width·height를 그대로 넣는다.
- alt는 사진 내용을 설명한다('주방 후드 청소 전후'). 키워드를 나열하지 않는다.

## 5. 검증

site_validate로 먼저 확인하고, 오류는 경로(예: content.services.items)를 보고 고친다.
`;

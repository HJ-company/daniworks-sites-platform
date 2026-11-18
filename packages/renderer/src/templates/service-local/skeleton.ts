/**
 * Shape-only example for AI agents (MCP `template_get`). Every text is a placeholder that says
 * what to write, so no real business's copy can leak into another customer's site.
 */
export const serviceLocalSkeleton = {
  version: 2,
  slug: "<영문 소문자·숫자·하이픈, 예: haneul-piano>",
  templateId: "service-local",
  preset: "<lesson | field>",
  paletteId: "<pine | ocean | clay>",
  meta: {
    title: "<상호 | 지역 + 대표 서비스, 60자 이내>",
    description: "<지역, 서비스, 강점을 담은 한두 문장, 160자 이내>",
  },
  business: {
    name: "<플레이스 정식 상호>",
    phone: "<플레이스 전화번호>",
    kakaoUrl: "<선택: https://pf.kakao.com/... 또는 https://open.kakao.com/...>",
    bookingUrl: "<선택: 네이버 예약 링크>",
    address: "<선택: 주소. 출장형은 생략 가능>",
    mapUrl: "<선택: 지도 공유 링크>",
    hours: [{ label: "<요일>", value: "<시간 또는 시간·장소>" }],
    serviceAreas: ["<수업 장소 또는 출장 지역>"],
    blogUrl: "<선택: https://blog.naver.com/아이디>",
    representative: "<대표자 이름. 모르면 '확인 필요'>",
  },
  content: {
    hero: {
      kicker: "<지역 + 업종 한 줄>",
      heading: "<손님이 얻는 것, \\n 포함 2줄 이내>",
      subheading: "<근거가 되는 사실 한두 문장>",
      image: { key: "<asset_upload 결과 m:… 또는 샘플 t:…>", alt: "<사진 내용 설명>", width: 0, height: 0 },
    },
    services: {
      heading: "<서비스·수업 섹션 제목>",
      items: [{ label: "<서비스 이름>", description: "<무엇을 어떻게, 1~2문장>", icon: "<선택: 허용 아이콘>" }],
    },
    process: { heading: "<진행 순서 제목>", items: [{ label: "<단계>", description: "<그 단계에서 하는 일>" }] },
    gallery: {
      heading: "<사례·현장 제목>",
      items: [{ label: "<사례 이름>", description: "<선택: 한 줄 설명>", image: { key: "<m:… 또는 t:…>", alt: "<사진 설명>" } }],
    },
    testimonials: { heading: "<후기 제목>", items: [{ quote: "<실제 후기 원문 취지, 지어내지 않음>", authorName: "<익명: 지역 고객 등>" }] },
    faqs: [{ question: "<손님이 실제로 묻는 질문>", answer: "<짧고 사실인 답>" }],
    cta: { heading: "<행동을 부르는 한 줄>", subheading: "<선택>" },
    inquiry: { heading: "<문의 폼 제목>", subheading: "<무엇을 적으면 되는지>" },
  },
} as const;

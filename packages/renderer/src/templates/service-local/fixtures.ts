import type { ServiceSiteConfigInput } from "@sites/schema";

/**
 * Local-only fixtures drafted from two public Naver blogs (a football academy and a move-in
 * cleaning company). Contacts are fake. Never publish these to a shared environment.
 */
export const lessonFixture: ServiceSiteConfigInput = {
  version: 2,
  slug: "jefes",
  templateId: "service-local",
  preset: "lesson",
  paletteId: "ocean",
  meta: {
    title: "제페스 풋볼 아카데미 | 도봉·노원 성인 축구·풋살 레슨",
    description: "도봉구·노원구 성인 축구·풋살 클래스. 초급부터 중급까지 레벨별로 배우고, 매 수업 경기까지 뛰는 제페스 풋볼 아카데미.",
  },
  business: {
    name: "제페스 풋볼 아카데미",
    phone: "010-0000-0000",
    kakaoUrl: "https://pf.kakao.com/_example",
    address: "서울 도봉구 방학동 도봉풋살장 외",
    hours: [
      { label: "화·수·금·토", value: "저녁 풋살장 클래스" },
      { label: "목", value: "20:00–22:00 노원구 축구장" },
    ],
    serviceAreas: ["도봉풋살장(방학동)", "아크풋살스타디움(창동)", "수락산스포츠타운 축구장"],
    blogUrl: "https://blog.naver.com/jefes_fc",
    schemaType: "SportsActivityLocation",
    representative: "홍길동",
  },
  content: {
    hero: {
      kicker: "도봉·노원 성인 축구·풋살 클래스",
      heading: "처음이어도 괜찮아요.\n배우고, 같이 뛰는 축구",
      subheading: "초급·초중급·중급 레벨별 수업. 1시간 훈련 뒤 1시간 경기로, 배운 것을 바로 써봅니다.",
      image: { key: "t:pine-trail", alt: "야외에서 운동하는 사람들" },
    },
    services: {
      kicker: "CLASSES",
      heading: "레벨과 일정에 맞는 클래스",
      subheading: "7개 클래스 중 4개가 초급반입니다. 어느 반이 맞을지 모르겠다면 편하게 물어보세요.",
      items: [
        { label: "초급반", description: "기본기부터 차근차근. 축구·풋살을 처음 시작하는 분도 본인 속도에 맞춰 배웁니다.", icon: "FaFutbol" },
        { label: "초중급반", description: "기본기 위에 드리블·패스 연결과 상황 인식을 더합니다." },
        { label: "중급반", description: "포지셔닝, 팀 전술, 마무리까지. 한층 더 프로처럼 배우고 싶은 분께 맞습니다." },
        { label: "축구장 클래스", description: "목요일 저녁 노원구 축구장에서 A·B·C 그룹으로 나눠 훈련하고 11대11 경기로 마무리합니다." },
      ],
    },
    process: {
      heading: "수업은 이렇게 진행돼요",
      items: [
        { label: "감각 훈련", description: "일찍 온 분부터 볼 감각을 깨우는 훈련으로 시작합니다." },
        { label: "메인 훈련", description: "코디네이션, 드리블, 패스 등 그날의 주제를 집중해서 배웁니다." },
        { label: "경기", description: "배운 내용을 경기에서 바로 써보며 마무리합니다." },
      ],
    },
    gallery: {
      heading: "수업 현장",
      items: [
        { label: "도봉클래스", description: "1대1 돌파 드리블과 수비를 3주간 집중 훈련했습니다.", image: { key: "t:pine-bench", alt: "운동장 벤치" } },
        { label: "자체 리그", description: "퍼플팀과 화이트팀으로 나눠 치르는 제페스 자체 리그.", image: { key: "t:pine-porch", alt: "야외 공간" } },
        { label: "K7 리그", description: "성인반 회원으로 구성된 제페스FC가 노원구 K7 리그에 2년째 참가하고 있습니다.", image: { key: "t:pine-cabin", alt: "야외 풍경" } },
      ],
    },
    testimonials: {
      heading: "회원님들의 이야기",
      items: [
        { quote: "처음엔 공 차는 것도 어색했는데, 초급반에서 기초부터 배우니 이제 경기에서 패스가 됩니다.", authorName: "월요일반 회원", rating: 5 },
        { quote: "훈련 한 시간, 경기 한 시간이라 배운 걸 바로 써볼 수 있어서 좋아요.", authorName: "수요일 저녁반 회원", rating: 5 },
        { quote: "레벨이 나뉘어 있어서 부담 없이 시작했어요. 분위기가 정말 좋습니다.", authorName: "혼성반 회원", rating: 5 },
      ],
    },
    faqs: [
      { question: "축구를 한 번도 안 해봤는데 괜찮을까요?", answer: "네. 7개 클래스 중 4개가 초급반이고, 기본기부터 본인 속도에 맞춰 배웁니다." },
      { question: "어느 반으로 가야 할지 모르겠어요.", answer: "구력과 원하는 수업 분위기를 알려주시면 맞는 반을 추천해 드립니다." },
      { question: "수업 시간은 얼마나 되나요?", answer: "총 2시간입니다. 보통 1시간 훈련 뒤 1시간 경기를 합니다." },
    ],
    cta: { heading: "이번 주 수업, 같이 뛰어요", subheading: "레벨과 가능한 요일을 알려주시면 맞는 클래스를 안내해 드립니다." },
    inquiry: { heading: "수업 상담 신청", subheading: "이름과 연락처, 궁금한 점을 남겨주세요. 확인 후 연락드립니다." },
  },
};

export const fieldFixture: ServiceSiteConfigInput = {
  version: 2,
  slug: "sangkwae",
  templateId: "service-local",
  preset: "field",
  paletteId: "pine",
  meta: {
    title: "상쾌공간 | 서울·경기 입주청소·이사청소",
    description: "하루 한 집만 청소하는 입주청소 전문. 서울·경기 전 지역 입주청소, 이사청소, 인테리어 후 분진 제거.",
  },
  business: {
    name: "상쾌공간",
    phone: "010-0000-0001",
    kakaoUrl: "https://open.kakao.com/o/example",
    hours: [{ label: "매일", value: "09:00–20:00 상담" }],
    serviceAreas: ["서울 전 지역", "경기 전 지역"],
    blogUrl: "https://blog.naver.com/jibsuri119_",
    representative: "김철수",
  },
  content: {
    hero: {
      kicker: "서울·경기 입주청소",
      heading: "하루 한 집만,\n보이지 않는 곳까지",
      subheading: "창틀 레일, 수납장 안쪽, 욕실 배수구처럼 놓치기 쉬운 곳부터 확인합니다.",
      image: { key: "t:pine-interior", alt: "정돈된 실내 공간" },
    },
    services: {
      heading: "청소 서비스",
      items: [
        { label: "입주청소", description: "신축·구축 입주 전 집 전체를 공간별로 청소합니다." },
        { label: "이사청소", description: "이전 거주 흔적과 주방 기름때, 욕실 물때를 정리합니다." },
        { label: "인테리어 후 분진 제거", description: "공사 뒤 바닥 틈과 창틀에 남은 고운 분진을 순서대로 제거합니다." },
        { label: "거주·정기청소", description: "살고 있는 집도 필요한 공간만 골라 맡길 수 있습니다." },
      ],
    },
    process: {
      heading: "진행 순서",
      items: [
        { label: "상담·견적", description: "집 종류와 크기, 방·화장실 수를 알려주시면 범위와 금액을 먼저 안내합니다." },
        { label: "작업 전 확인", description: "현장을 돌아보며 오염이 많은 곳과 추가 작업이 필요한 곳을 함께 확인합니다." },
        { label: "공간별 청소", description: "주방, 욕실, 창틀, 베란다, 수납공간 순서로 작업합니다." },
        { label: "마무리 점검", description: "작업 뒤 함께 둘러보며 확인하고 마칩니다." },
      ],
    },
    gallery: {
      heading: "작업 사례",
      items: [
        { label: "상계주공 7단지 입주청소", description: "주방 후드 필터와 창틀 안쪽 묵은 먼지까지 정리했습니다.", image: { key: "t:pine-breakfast", alt: "깨끗한 주방" } },
        { label: "쌍문동 아파트 입주청소", description: "오래된 아파트의 창틀 먼지, 주방 기름때, 욕실 물때를 제거했습니다.", image: { key: "t:clay-shelves", alt: "정리된 수납장" } },
      ],
    },
    testimonials: {
      heading: "고객 후기",
      items: [{ quote: "견적 받은 금액 그대로였고, 창틀 레일까지 깨끗해서 놀랐어요.", authorName: "노원구 고객", rating: 5 }],
    },
    faqs: [
      { question: "추가 요금이 있나요?", answer: "상담 때 집 상태와 범위를 확인하고 금액을 안내합니다. 현장에서 범위가 바뀌는 경우에만 미리 말씀드리고 조정합니다." },
      { question: "당일에 무엇을 준비하면 되나요?", answer: "전기와 물을 쓸 수 있는지, 짐을 모두 뺐는지, 주차가 가능한지만 확인해 주세요." },
    ],
    cta: { heading: "이사 날짜가 잡혔다면 먼저 일정부터", subheading: "하루 한 집만 작업해서 일정이 빨리 찹니다." },
    inquiry: { heading: "견적 문의", subheading: "주소(동까지), 평수, 희망 날짜를 남겨주세요." },
  },
};

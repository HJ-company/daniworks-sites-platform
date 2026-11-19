import { serviceLocalGuide } from "@sites/renderer";

/**
 * Guides that ship with the platform. Copied into D1 the first time guides are read, after which
 * the stored copy (editable through MCP, versioned) is what agents see. Sources: the template
 * guide in the renderer, the PRD's product rules and the image policy.
 */
export interface GuideDefault {
  slug: string;
  title: string;
  kind: "policy" | "industry" | "design" | "writing";
  scope: "operator" | "customer";
  summary: string;
  body: string;
}

export const GUIDE_DEFAULTS: GuideDefault[] = [
  {
    slug: "industry-service-local",
    title: "업종: 레슨·교육·출장 서비스 (service-local)",
    kind: "industry",
    scope: "operator",
    summary: "preset 고르기, 자료에서 뽑을 필드, 쓰는 원칙, 사진, 검증",
    body: serviceLocalGuide,
  },
  {
    slug: "writing-rules",
    title: "작성 규칙",
    kind: "writing",
    scope: "operator",
    summary: "카피 톤, 금지 표현, 구조화 데이터, 이미지 용도(AI 이미지 포함)",
    body: `# 작성 규칙

## 카피 톤

- 사장님이 손님에게 직접 말하듯 쓴다. 존댓말, 짧은 문장.
- 손님이 고르는 단위(서비스, 수업)로 나눠 쓴다. 회사 소개보다 손님이 받는 것을 먼저.
- 같은 단어를 반복해 검색어를 채우지 않는다. 지역명·서비스명은 자연스러운 곳에 한두 번.

## 금지 표현

- 자료에 없는 수치(경력 연수, 고객 수, 수상)를 만들지 않는다.
- '최고', '1위', '100% 보장', '업계 최저가' 같은 최상급·보장 표현을 쓰지 않는다.
- 후기는 원문의 뜻을 바꾸지 않는다. 이름은 '노원구 고객'처럼 익명으로.
- 연락처·가격은 자료와 정확히 같아야 한다. 확인되지 않으면 비우고 운영자에게 묻는다.

## 구조화 데이터

- 업체 정보(상호, 전화, 주소, 영업시간, 지역)는 config.business에 정확히 넣으면 렌더러가 구조화 데이터를 만든다. 따로 쓰지 않는다.
- FAQ는 AI 검색 답변에 인용되기 좋은 짧은 문답으로 쓴다. 한 답은 2~3문장.

## 이미지 용도

- 시공 사례·음식·매장·수업 장면처럼 실제 작업물은 고객 사진만 쓴다.
- AI 생성 이미지(image_generate)는 배경·일러스트·분위기 이미지에만 쓴다(purpose: background, illustration, mood).
- 예외: 고객이 직접 요청하면 실제 작업물 용도(purpose: work)로도 만든다. 이때 customerRequest에 요청 경로(카톡 등)·일시·내용 요약을 반드시 남긴다.
- alt는 사진 내용을 설명한다. 키워드를 나열하지 않는다.
`,
  },
  {
    slug: "product-policy",
    title: "상품·계약 요약",
    kind: "policy",
    scope: "operator",
    summary: "가격, 시안부터 공개까지의 순서, 결제 전 공개 금지, 해지 후 보관",
    body: `# 상품·계약 요약

정책의 기준은 노션 정책서다. 이 문서는 사이트를 만들 때 알아야 할 부분만 요약한다.

## 상품

- 블로그·네이버 플레이스·인스타 정보로 원페이지 홈페이지를 만든다. 2페이지 이상, 예약·결제·회원 기능은 없다.
- 구독은 사이트마다: 월 33,000원 또는 연 396,000원(부가세 포함, 공급가 30,000원·360,000원). 사이트마다 금액을 바꿀 수 있다. 사장님께 금액을 말할 때는 부가세 포함 금액으로 말한다.

## 순서

1. 고객(사장님)을 등록하고 사이트를 만든다(customer_create, site_create).
2. 시안을 쓰고 검증한 뒤 사장님용 시안 링크를 만든다(site_preview_link). 운영자가 카톡으로 보낸다.
3. 사장님이 확정하면 운영자가 청구하고, 입금이 확인되면 게시한다.
4. 입금 확인 전에는 게시할 수 없다. 예외는 없다(site_publish가 거부한다).

## 수정과 해지

- 수정 요청은 카톡으로 받아 draft로 반영하고 운영자 검수 뒤 게시한다. 시안 링크는 그대로 최신 버전을 보여준다.
- 해지하면 공개를 멈추고 자료는 1년 보관한다.
`,
  },
  {
    slug: "design",
    title: "디자인 지침",
    kind: "design",
    scope: "operator",
    summary: "팔레트, 사진 톤, 섹션 구성",
    body: `# 디자인 지침

블록 종류·순서·디자인은 업종 템플릿이 정한다. 작성자는 팔레트와 사진, 문구만 고른다.

## 팔레트

- pine(초록): 청소·설비·자연 소재와 잘 맞는다.
- ocean(파랑): 교육·레슨·전문 서비스.
- clay(흙색): 공방·인테리어·음식처럼 따뜻한 느낌.
- 업종에 맞는 것이 없으면 preset의 기본 팔레트를 쓴다.

## 사진 톤

- 밝고 정돈된 실제 현장 사진을 고른다. 흐리거나 어두운 사진은 쓰지 않는다.
- 첫 화면 사진은 가로 사진, 긴 변 1600px 이상이 좋다. 블로그 사진(900px 안팎)은 첫 화면에 작으니 원본을 요청한다.
- 같은 사진을 두 섹션에 쓰지 않는다.

## 섹션

- 서비스는 2~8개, 진행 순서는 2~6단계.
- 작업 사례는 사진이 있을 때만 넣는다.
`,
  },
];

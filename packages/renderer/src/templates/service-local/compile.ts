import { businessBasicTemplate, type TemplateAsset, type TemplateSeed } from "@dani-builder/site-templates";
import type { Photo, ServiceSiteConfig } from "@sites/schema";
import { presets } from "./presets.js";

/** Packaged sample photos by file name (`t:<name>`), shared by every composition. */
const samples = new Map<string, TemplateAsset>(
  Object.values(businessBasicTemplate.compositions)
    .flatMap((composition) => composition.seed.assets)
    .map((asset) => [asset.src.replace(/^.*\//, "").replace(/\.(jpg|png)$/, ""), asset]),
);

export const SAMPLE_PHOTOS: readonly string[] = [...samples.keys()];

/** Media URL path for an uploaded photo key `m:<siteId>/<file>`; served by both router and API. */
export const mediaPath = (key: string) => `/_media/${key.slice(2)}`;

type Block = Record<string, unknown>;
type Paragraph = { type: "paragraph"; children: { type: "text"; text: string }[] };
type Heading = { type: "heading"; level: number; children: { type: "text"; text: string }[] };

const paragraphs = (value: string): Paragraph[] =>
  value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph", children: [{ type: "text", text: part }] }));

const heading = (text: string): Heading => ({ type: "heading", level: 2, children: [{ type: "text", text }] });

export const telHref = (phone: string) => `tel:${phone.replace(/-/g, "")}`;

function section(
  value: { kicker?: string; heading: string; subheading?: string },
  extra: Record<string, unknown> = {},
) {
  return {
    kickerText: value.kicker ?? null,
    heading: value.heading,
    subheading: value.subheading ?? null,
    theme: "default",
    ...extra,
  };
}

/** TemplateSeed rejects `undefined`; JSON round-trip drops optional keys that were never set. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Compiles a `service-local` config into a Builder TemplateSeed: one landing page plus the
 * privacy page. Block choice, order and variants belong to the template, never to the author.
 */
export function compileServiceSeed(config: ServiceSiteConfig): TemplateSeed {
  const { business, content } = config;
  const preset = presets[config.preset];
  const assets = new Map<string, TemplateAsset>();

  function image(photo: Photo) {
    if (!assets.has(photo.key)) {
      if (photo.key.startsWith("t:")) {
        const sample = samples.get(photo.key.slice(2));
        if (!sample) throw new Error(`없는 샘플 사진입니다: ${photo.key}`);
        assets.set(photo.key, { ...sample, key: photo.key, alt: photo.alt });
      } else {
        assets.set(photo.key, {
          key: photo.key,
          src: mediaPath(photo.key),
          alt: photo.alt,
          role: "image",
          width: photo.width ?? 1600,
          height: photo.height ?? 1200,
          mime: photo.key.endsWith(".png") ? "image/png" : "image/jpeg",
          sourceUrl: "customer-upload",
          sourceImageUrl: "customer-upload",
          author: business.name,
          authorUrl: null,
          licenseUrl: "customer-provided",
          sampleNotice: "",
        });
      }
    }
    return { media: { assetKey: photo.key }, alt: photo.alt, fit: "cover" };
  }

  const tel = { label: "전화 상담", href: telHref(business.phone), newWindow: false, icon: null };
  const inquiryLink = { label: preset.inquiryCta, href: "/#inquiry", newWindow: false, icon: null };
  const kakao = business.kakaoUrl
    ? { label: "카카오톡 상담", href: business.kakaoUrl, newWindow: true, icon: null }
    : null;

  const blocks: Block[] = [];
  blocks.push({
    __component: "blocks.hero",
    section: section(content.hero),
    variant: preset.heroVariant,
    ctaText: null,
    ctaLink: inquiryLink,
    secondaryLink: tel,
    headerMode: "none",
    image: image(content.hero.image),
  });
  blocks.push({
    __component: "blocks.features",
    section: section(content.services, { anchorId: "services" }),
    variant: preset.servicesVariant,
    image: null,
    items: content.services.items.map((item) => ({
      label: item.label,
      description: item.description,
      icon: item.icon ?? null,
      link: null,
    })),
  });
  if (content.process) {
    blocks.push({
      __component: "blocks.features",
      section: section(content.process, { anchorId: "process", theme: "light" }),
      variant: "simple-grid",
      image: null,
      items: content.process.items.map((item) => ({ label: item.label, description: item.description, link: null })),
    });
  }
  if (content.gallery) {
    blocks.push({
      __component: "blocks.highlights",
      section: section(content.gallery, { anchorId: "gallery" }),
      variant: preset.galleryVariant,
      image: null,
      items: content.gallery.items.map((item) => ({
        label: item.label,
        description: item.description ?? null,
        image: image(item.image),
        link: null,
      })),
    });
  }
  if (content.testimonials) {
    blocks.push({
      __component: "blocks.testimonials",
      section: section(content.testimonials, { anchorId: "reviews", theme: "light" }),
      variant: "card-grid",
      image: null,
      items: content.testimonials.items.map((item) => ({
        quote: item.quote,
        authorName: item.authorName ?? null,
        authorRole: item.authorRole ?? null,
        avatar: null,
        logo: null,
        rating: item.rating ?? null,
      })),
    });
  }
  if (content.team) {
    blocks.push({
      __component: "blocks.team",
      section: section(content.team, { anchorId: "team" }),
      variant: "grid",
      items: content.team.items.map((item) => ({
        memberName: item.memberName,
        role: item.role ?? null,
        bio: item.bio ?? null,
        photo: item.photo ? image(item.photo).media : null,
        socialLinks: [],
      })),
    });
  }
  if (content.pricing) {
    const count = content.pricing.items.length;
    blocks.push({
      __component: "blocks.pricing",
      section: section(content.pricing, { anchorId: "pricing" }),
      variant: count === 1 ? "single" : count === 2 ? "two-column" : "three-column",
      items: content.pricing.items.map((item) => ({
        planName: item.planName,
        price: item.price,
        billingPeriod: item.billingPeriod ?? null,
        description: item.description ?? null,
        featureList: item.features.map((feature) => `- ${feature}`).join("\n") || null,
        ctaLink: inquiryLink,
        highlighted: item.highlighted,
      })),
    });
  }

  const info: Block[] = [];
  if (business.hours.length) {
    info.push({
      label: "운영 시간",
      description: business.hours.map((h) => `${h.label} ${h.value}`).join("\n\n"),
      link: null,
    });
  }
  if (business.serviceAreas.length) {
    info.push({ label: preset.areasLabel, description: business.serviceAreas.join(", "), link: null });
  }
  info.push({
    label: "상담",
    description: [`전화 ${business.phone}`, business.address].filter(Boolean).join("\n\n"),
    link: business.mapUrl ? { label: "지도 보기", href: business.mapUrl, newWindow: true, icon: null } : tel,
  });
  blocks.push({
    __component: "blocks.features",
    section: { kickerText: null, heading: preset.infoHeading, subheading: null, theme: "muted", anchorId: "info" },
    variant: "dual-column",
    image: null,
    items: info,
  });

  const faqs = content.faqs.map((faq, index) => ({
    key: `faq:${index + 1}`,
    locale: "ko",
    question: faq.question,
    sortOrder: index + 1,
    answer: paragraphs(faq.answer),
  }));
  if (faqs.length) {
    blocks.push({
      __component: "blocks.faq",
      section: { kickerText: "FAQ", heading: "자주 묻는 질문", subheading: null, theme: "default", anchorId: "faq" },
      items: faqs.map((faq) => ({ relationKey: faq.key })),
    });
  }
  blocks.push({
    __component: "blocks.inquiry-form",
    section: section(content.inquiry, { anchorId: "inquiry" }),
    successMessage: "문의가 접수되었습니다.\n남겨주신 연락처로 곧 연락드릴게요.",
    errorMessage: "전송하지 못했습니다. 잠시 뒤 다시 시도하시거나 전화로 문의해 주세요.",
  });
  blocks.push({
    __component: "blocks.cta",
    section: section(content.cta, { theme: "accent" }),
    // card-* renders light buttons on a light card under an accent theme (Builder issue draft:
    // docs/builder-issues.md); inline-centered keeps both links readable.
    variant: "inline-centered",
    ctaText: null,
    ctaLink: tel,
    secondaryLink: kakao ?? inquiryLink,
    image: null,
  });

  const privacy = {
    key: "page:privacy",
    locale: "ko",
    title: "개인정보처리방침",
    slug: "privacy",
    directAccess: true,
    route: "/privacy",
    headerMode: "offset",
    blocks: [
      {
        __component: "blocks.content",
        section: { kickerText: null, heading: "개인정보처리방침", subheading: null, theme: "default" },
        variant: "prose",
        body: privacyBody(config),
      },
    ],
  };

  const navGroups = [
    { label: preset.nav.services, href: "/#services", links: [] },
    ...(content.gallery ? [{ label: preset.nav.gallery, href: "/#gallery", links: [] }] : []),
    ...(content.testimonials ? [{ label: preset.nav.reviews, href: "/#reviews", links: [] }] : []),
    { label: preset.nav.info, href: "/#info", links: [] },
  ];
  const businessInfo = [
    [`대표 ${business.representative}`, business.businessNumber && `사업자등록번호 ${business.businessNumber}`]
      .filter(Boolean)
      .join(" · "),
    business.address,
    `전화 ${business.phone}`,
  ]
    .filter(Boolean)
    .join("\n");

  return plain({
    assets: [...assets.values()],
    pages: [
      {
        key: "page:home",
        locale: "ko",
        title: business.name,
        slug: "home",
        directAccess: false,
        route: "/",
        headerMode: "offset",
        blocks,
      },
      privacy,
    ],
    faqs,
    navigation: {
      key: "navigation:main",
      locale: "ko",
      align: "right",
      mainLogo: null,
      darkLogo: null,
      groups: navGroups,
      primaryLink: inquiryLink,
      secondaryLink: null,
    },
    global: {
      key: "global:site",
      locale: "ko",
      sitename: business.name,
      home: { relationKey: "page:home" },
      footer: {
        organization: business.name,
        businessInfo,
        logo: null,
        sitemap: [
          {
            label: "안내",
            links: [
              { label: "개인정보처리방침", href: "/privacy", newWindow: false, icon: null },
              ...(business.blogUrl ? [{ label: "블로그", href: business.blogUrl, newWindow: true, icon: null }] : []),
            ],
          },
        ],
        otherLinks: [],
        socialLinks: [],
      },
    },
  }) as unknown as TemplateSeed;
}

/** Inquiry-form privacy policy. Operators confirm it with the customer before opening. */
function privacyBody(config: ServiceSiteConfig): (Paragraph | Heading)[] {
  const { business } = config;
  const contact = business.privacyEmail ? `${business.phone}, ${business.privacyEmail}` : business.phone;
  return [
    ...paragraphs(
      `${business.name}(이하 '회사')는 홈페이지 문의를 처리하기 위해 아래와 같이 개인정보를 수집·이용합니다.`,
    ),
    heading("수집 항목과 목적"),
    ...paragraphs("이름, 연락처, 문의 내용을 상담과 답변을 위해서만 수집합니다."),
    heading("보유 기간"),
    ...paragraphs("문의일로부터 1년간 보관한 뒤 지체 없이 파기합니다. 요청하시면 그 전에라도 삭제합니다."),
    heading("처리 위탁"),
    ...paragraphs("홈페이지 운영과 문의 저장은 다니웍스에 위탁합니다. 수탁자는 위탁 목적 밖으로 개인정보를 이용하지 않습니다."),
    heading("개인정보 보호책임자"),
    ...paragraphs(`${business.representative} (${contact})`),
    heading("이용자의 권리"),
    ...paragraphs("언제든 개인정보 열람, 정정, 삭제, 처리 정지를 요청할 수 있으며 위 연락처로 요청하시면 됩니다."),
  ];
}

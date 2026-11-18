import { z } from "zod";

/**
 * Site config v2: an industry template plus the content an AI or operator fills in.
 * The template, not the author, decides which Builder blocks and variants render it.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const httpsUrl = z.string().trim().regex(/^https:\/\/[^\s]+$/, "https:// 주소여야 합니다");

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Photo reference. `m:<siteId>/<file>` is an uploaded photo (R2), `t:<name>` a packaged
 * template sample. Width and height come from the upload response and keep layout stable.
 */
export const photoSchema = z.object({
  key: z.string().regex(/^(m:[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|png)|t:[a-z0-9-]+)$/, "m:<siteId>/<파일> 또는 t:<샘플> 형식"),
  alt: text(120),
  width: z.int().min(1).max(8000).optional(),
  height: z.int().min(1).max(8000).optional(),
});

export const PRESETS = ["lesson", "field"] as const;
export const SCHEMA_TYPES = [
  "LocalBusiness",
  "EducationalOrganization",
  "SportsActivityLocation",
  "HomeAndConstructionBusiness",
  "ProfessionalService",
] as const;

export const businessSchema = z.object({
  name: text(40),
  /** Korean landline, mobile, 0507 safe number or 1588-style number; hyphens optional. */
  phone: z.string().trim().regex(/^(0\d{1,3}-?\d{3,4}-?\d{4}|1\d{3}-?\d{4})$/, "전화번호 형식이 아닙니다"),
  kakaoUrl: httpsUrl.regex(/^https:\/\/(pf|open)\.kakao\.com\//, "카카오 채널·오픈채팅 주소여야 합니다").optional(),
  bookingUrl: httpsUrl.optional(),
  address: optionalText(120),
  mapUrl: httpsUrl.optional(),
  hours: z.array(z.object({ label: text(20), value: text(60) })).max(8).default([]),
  serviceAreas: z.array(text(30)).max(20).default([]),
  /** Naver blog home (https://blog.naver.com/<id>); its RSS feeds the latest-posts section. */
  blogUrl: httpsUrl.regex(/^https:\/\/(m\.)?blog\.naver\.com\/[A-Za-z0-9_-]+\/?$/, "네이버 블로그 주소여야 합니다").optional(),
  schemaType: z.enum(SCHEMA_TYPES).optional(),
  representative: text(20),
  businessNumber: z.string().trim().regex(/^\d{3}-?\d{2}-?\d{5}$/, "사업자등록번호 형식이 아닙니다").optional(),
  privacyEmail: z.email().optional(),
});

const sectionHeading = { kicker: optionalText(40), heading: text(80), subheading: optionalText(200) };

export const serviceContentSchema = z.object({
  hero: z.object({ ...sectionHeading, image: photoSchema }),
  services: z.object({
    ...sectionHeading,
    items: z.array(z.object({ label: text(40), description: text(300), icon: optionalText(40) })).min(2).max(8),
  }),
  process: z
    .object({ ...sectionHeading, items: z.array(z.object({ label: text(40), description: text(200) })).min(2).max(6) })
    .optional(),
  gallery: z
    .object({
      ...sectionHeading,
      items: z.array(z.object({ label: text(60), description: optionalText(300), image: photoSchema })).min(1).max(9),
    })
    .optional(),
  testimonials: z
    .object({
      ...sectionHeading,
      items: z
        .array(
          z.object({
            quote: text(400),
            authorName: optionalText(30),
            authorRole: optionalText(40),
            rating: z.int().min(1).max(5).optional(),
          }),
        )
        .min(1)
        .max(9),
    })
    .optional(),
  team: z
    .object({
      ...sectionHeading,
      items: z
        .array(z.object({ memberName: text(30), role: optionalText(40), bio: optionalText(300), photo: photoSchema.optional() }))
        .min(1)
        .max(8),
    })
    .optional(),
  pricing: z
    .object({
      ...sectionHeading,
      items: z
        .array(
          z.object({
            planName: text(40),
            price: text(30),
            billingPeriod: optionalText(20),
            description: optionalText(200),
            features: z.array(text(80)).max(8).default([]),
            highlighted: z.boolean().default(false),
          }),
        )
        .min(1)
        .max(4),
    })
    .optional(),
  faqs: z.array(z.object({ question: text(120), answer: text(800) })).max(10).default([]),
  cta: z.object({ heading: text(80), subheading: optionalText(200) }),
  inquiry: z.object({ heading: text(80), subheading: optionalText(200) }),
});

export const serviceSiteConfigSchema = z.object({
  version: z.literal(2),
  slug: z.string().regex(SLUG_PATTERN, "소문자·숫자·하이픈 1~40자"),
  templateId: z.literal("service-local"),
  preset: z.enum(PRESETS),
  paletteId: text(20),
  meta: z.object({ title: text(60), description: text(160) }),
  business: businessSchema,
  content: serviceContentSchema,
});

export type Photo = z.infer<typeof photoSchema>;
export type Business = z.infer<typeof businessSchema>;
export type ServiceContent = z.infer<typeof serviceContentSchema>;
export type ServiceSiteConfig = z.infer<typeof serviceSiteConfigSchema>;
export type ServiceSiteConfigInput = z.input<typeof serviceSiteConfigSchema>;
export type Preset = (typeof PRESETS)[number];

/** Zod issues as `path: message` lines, the same shape the API returns for every validation error. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`);
}

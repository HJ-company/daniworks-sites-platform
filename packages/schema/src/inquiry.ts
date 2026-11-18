import { z } from "zod";

/** What a visitor's inquiry form posts to `/api/inquiry`. */
export const inquirySubmissionSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요").max(30),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^0\d{8,11}$/, "연락처를 확인해 주세요")),
  message: z.string().trim().min(1, "문의 내용을 입력해 주세요").max(1000),
  consent: z.literal(true, { error: "개인정보 수집·이용에 동의해 주세요" }),
  page: z.string().max(200).optional(),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(200).optional(),
  /** Milliseconds between form render and submit; bots submit instantly. */
  elapsedMs: z.number().int().nonnegative().optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export type InquirySubmission = z.infer<typeof inquirySubmissionSchema>;

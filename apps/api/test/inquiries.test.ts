import { describe, expect, it, vi } from "vitest";
import { inquirySubmissionSchema } from "@sites/schema";
import { displayPhone, inquiriesCsv } from "../src/inquiries.js";
import { verifyTurnstile } from "../src/turnstile.js";

const valid = { name: "홍길동", phone: "010-1234-5678", message: "문의", consent: true };

describe("inquirySubmissionSchema", () => {
  it("normalizes the phone number", () => {
    expect(inquirySubmissionSchema.parse(valid).phone).toBe("01012345678");
  });
  it.each([
    [{ ...valid, consent: false }, "consent"],
    [{ ...valid, phone: "12345" }, "phone"],
    [{ ...valid, name: " " }, "name"],
    [{ ...valid, message: "x".repeat(1001) }, "message"],
  ])("rejects %j", (input, path) => {
    const result = inquirySubmissionSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe(path);
  });
});

describe("inquiriesCsv", () => {
  it("writes an Excel-friendly CSV and neutralizes formulas", () => {
    const csv = inquiriesCsv([
      { id: "1", name: "=HYPERLINK(\"x\")", phone: "01012345678", message: 'say "hi"\nline2', page: "/", notify_status: "sent", created_at: "2026-11-18T15:30:00.000Z" },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"2026-11-19 00:30"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"010-1234-5678"');
    expect(csv).toContain('"say ""hi""\nline2"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("verifyTurnstile", () => {
  it("skips when no secret is configured", async () => {
    expect((await verifyTurnstile(undefined, undefined, null)).ok).toBe(true);
  });
  it("requires a token when configured", async () => {
    expect(await verifyTurnstile("secret", undefined, null)).toEqual({ ok: false, reason: "missing-token" });
  });
  it("passes siteverify results through", async () => {
    const ok = vi.fn(async () => Response.json({ success: true }));
    const bad = vi.fn(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
    expect((await verifyTurnstile("s", "t", "1.2.3.4", ok as typeof fetch)).ok).toBe(true);
    expect(await verifyTurnstile("s", "t", null, bad as typeof fetch)).toEqual({ ok: false, reason: "invalid-input-response" });
  });
  it("fails closed when siteverify is unreachable", async () => {
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    expect((await verifyTurnstile("s", "t", null, down as typeof fetch)).ok).toBe(false);
  });
});

describe("displayPhone", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["05071234567", "0507-123-4567"],
    ["050712345678", "0507-1234-5678"],
    ["0311234567", "031-123-4567"],
  ])("%s → %s", (digits, shown) => {
    expect(displayPhone(digits)).toBe(shown);
  });
});

import { describe, expect, it } from "vitest";
import { BOT_UA, kstDay } from "../src/metrics.js";

describe("BOT_UA", () => {
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.1.0",
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.1)",
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 DaumApps/8.1.0",
  ])("counts people: %s", (ua) => {
    expect(BOT_UA.test(ua)).toBe(false);
  });

  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
    "Mozilla/5.0 (compatible; Daumoa/4.0)",
    "facebookexternalhit/1.1",
    "kakaotalk-scrap/1.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "curl/8.5.0",
  ])("ignores bots: %s", (ua) => {
    expect(BOT_UA.test(ua)).toBe(true);
  });
});

describe("kstDay", () => {
  it("uses the Korean calendar day", () => {
    expect(kstDay(new Date("2026-11-18T14:59:59Z"))).toBe("2026-11-18");
    expect(kstDay(new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-19");
  });
});

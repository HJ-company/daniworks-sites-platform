import { describe, expect, it } from "vitest";
import { isApex, normalizeHostname } from "../src/domains.js";

describe("normalizeHostname", () => {
  it.each([
    ["WWW.Example.co.kr", "www.example.co.kr"],
    ["https://www.example.com/path", "www.example.com"],
    ["shop.example.kr.", "shop.example.kr"],
  ])("%s → %s", (input, host) => {
    expect(normalizeHostname(input, "dsites.kr")).toBe(host);
  });

  it.each(["", "localhost", "a..b.com", "under_score.com", "dsites.kr", "x.dsites.kr", "jefes.localhost", "-bad.com"])(
    "rejects %s",
    (input) => {
      expect(() => normalizeHostname(input, "dsites.kr")).toThrow();
    },
  );
});

describe("isApex", () => {
  it.each([
    ["example.co.kr", true],
    ["www.example.co.kr", false],
    ["example.kr", true],
    ["www.example.kr", false],
    ["example.com", true],
    ["shop.example.com", false],
    ["example.xyz", true],
  ])("%s → %s", (host, apex) => {
    expect(isApex(host)).toBe(apex);
  });
});

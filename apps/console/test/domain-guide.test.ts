import { describe, expect, it } from "vitest";
import type { DomainRow } from "../src/api.js";
import { customerGuide, domainErrorText, hostLabel } from "../src/pages/site/domain-guide.js";

const row = (hostname: string, host: string | undefined, zone: string | undefined, apex = false): DomainRow => ({
  hostname,
  kind: "custom",
  status: "pending",
  ssl_status: null,
  last_error: null,
  checked_at: null,
  verification_records: {
    cname: { type: "CNAME", name: hostname, value: "connect.dsites.kr" },
    host,
    zone,
    optionalTxt: null,
    apex,
    note: null,
  },
});

describe("domain guide", () => {
  it("host label comes from the api, else the full hostname", () => {
    expect(hostLabel(row("www.shop.dobong.com", "www.shop", "dobong.com"))).toBe("www.shop");
    expect(hostLabel(row("www.dobong.co.kr", undefined, undefined))).toBe("www.dobong.co.kr");
  });

  it("customer message has the record and root forwarding for www hosts", () => {
    const text = customerGuide(row("www.dobong.co.kr", "www", "dobong.co.kr"));
    expect(text).toContain("· 유형: CNAME");
    expect(text).toContain("· 이름(호스트): www");
    expect(text).toContain("· 값: connect.dsites.kr");
    expect(text).toContain("dobong.co.kr → https://www.dobong.co.kr");
  });

  it("no forwarding line for other subdomains", () => {
    const text = customerGuide(row("www.shop.dobong.com", "www.shop", "dobong.com"));
    expect(text).toContain("· 이름(호스트): www.shop");
    expect(text).not.toContain("도메인 포워딩");
  });

  it("apex message warns that most registrars cannot do it", () => {
    const text = customerGuide(row("dobong.co.kr", "@", "dobong.co.kr", true));
    expect(text).toContain("· 이름(호스트): @");
    expect(text).toContain("대부분의 국내 업체");
  });

  it("translates Cloudflare errors and keeps unknown ones visible", () => {
    expect(domainErrorText("custom hostname does not CNAME to this zone.")).toContain("CNAME이 설정되지 않았거나");
    expect(domainErrorText("something new")).toBe("확인 결과: something new");
    expect(domainErrorText(null)).toBeNull();
  });
});

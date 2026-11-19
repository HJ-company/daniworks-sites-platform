import type { DomainRow } from "../../api.js";

/** Cloudflare's verification errors in words an operator can pass on. */
export function domainErrorText(error: string | null): string | null {
  if (!error) return null;
  if (/does not CNAME to this zone|cname.*not.*found|no cname/i.test(error)) {
    return "아직 CNAME이 설정되지 않았거나 반영되지 않았습니다. 설정했다면 잠시 뒤 다시 확인하세요.";
  }
  if (/nxdomain|could not resolve|not resolve|no such host/i.test(error)) return "도메인을 찾지 못했습니다. 주소 철자와 도메인 만료 여부를 확인하세요.";
  if (/caa/i.test(error)) return "도메인의 CAA 설정이 인증서 발급을 막고 있습니다. 등록업체에서 CAA 레코드를 확인해야 합니다.";
  if (/timeout|timed out|unavailable|5\d\d/i.test(error)) return "Cloudflare 확인이 일시적으로 실패했습니다. 잠시 뒤 다시 확인하세요.";
  return `확인 결과: ${error}`;
}

/**
 * What the customer types in the registrar's host field (`www`, `www.shop`, `@`). When the api
 * could not tell (unknown suffix, rows from before M4) it is the full hostname, which every
 * registrar accepts.
 */
export const hostLabel = (d: DomainRow) => d.verification_records?.host ?? d.hostname;

/** Message the operator pastes into KakaoTalk for the customer. */
export function customerGuide(d: DomainRow): string {
  const records = d.verification_records!;
  const record = [`· 유형: ${records.cname.type}`, `· 이름(호스트): ${hostLabel(d)}`, `· 값: ${records.cname.value}`];
  if (records.apex) {
    return [
      "[홈페이지 도메인 연결 안내]",
      `사장님, ${d.hostname} 주소를 홈페이지에 연결하려면 도메인을 구입하신 곳의 DNS 관리 화면에서 아래 레코드를 추가해야 합니다.`,
      "",
      ...record,
      "",
      "다만 www 없는 주소(@)에는 대부분의 국내 업체(가비아·카페24 등)가 이 설정을 지원하지 않습니다. 설정 화면에서 추가가 안 되면 알려주세요. www가 붙은 주소로 연결하고 www 없는 주소는 그쪽으로 넘어가도록 다시 안내해 드리겠습니다.",
    ].join("\n");
  }
  const forwarding =
    hostLabel(d) === "www" && records.zone
      ? [`www 없이 ${records.zone} 로 들어오는 방문자도 받으시려면, 같은 곳의 '도메인 포워딩'에서 ${records.zone} → https://${d.hostname} 으로 연결해 주세요.`, ""]
      : [];
  return [
    "[홈페이지 도메인 연결 안내]",
    `사장님, ${d.hostname} 주소를 홈페이지에 연결하려면 도메인을 구입하신 곳(가비아·카페24·후이즈 등)의 DNS 관리 화면에서 아래 레코드 1개를 추가해 주세요.`,
    "",
    ...record,
    "",
    ...forwarding,
    "저장 후 반영까지 몇 분에서 길게는 하루가 걸릴 수 있습니다. 설정하시고 알려주시면 연결을 확인해 드리겠습니다.",
  ].join("\n");
}

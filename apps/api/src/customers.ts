import { sitePayments, subscriptionOf, type PaymentRow } from "./billing.js";
import { HttpError } from "./http.js";
import { BUSINESS_NAME_SQL } from "./store.js";

/**
 * Customers (business owners). One customer may hold several sites; each site is billed on
 * its own subscription. Leads live outside the platform; `external_ref` links to them.
 */
export interface CustomerRow {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  business_number: string | null;
  invoice_email: string | null;
  external_ref: string | null;
  memo: string | null;
  status: "active" | "cancelled";
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = { column: keyof CustomerRow; max: number; label: string; check?: (value: string) => string | null };

const FIELDS: Record<string, Field> = {
  name: { column: "name", max: 60, label: "업체명" },
  contactName: { column: "contact_name", max: 30, label: "담당자" },
  phone: {
    column: "phone",
    max: 20,
    label: "연락처",
    check: (v) => (/^[0-9+\-() ]{8,20}$/.test(v) ? null : "연락처는 숫자와 하이픈으로 입력하세요"),
  },
  email: { column: "email", max: 120, label: "이메일", check: (v) => (EMAIL.test(v) ? null : "이메일 형식이 아닙니다") },
  businessNumber: {
    column: "business_number",
    max: 12,
    label: "사업자등록번호",
    check: (v) => (/^\d{3}-?\d{2}-?\d{5}$/.test(v) ? null : "사업자등록번호는 숫자 10자리입니다"),
  },
  invoiceEmail: { column: "invoice_email", max: 120, label: "계산서 이메일", check: (v) => (EMAIL.test(v) ? null : "이메일 형식이 아닙니다") },
  externalRef: { column: "external_ref", max: 300, label: "외부 리드 링크" },
  memo: { column: "memo", max: 500, label: "메모" },
};

/** Validated column values from a request body; only the keys present are returned. */
function columnsFrom(body: Record<string, unknown>) {
  const out: Partial<Record<keyof CustomerRow, string | null>> = {};
  const errors: string[] = [];
  for (const [key, field] of Object.entries(FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw !== null && raw !== undefined && typeof raw !== "string") {
      errors.push(`${field.label}: 문자열이어야 합니다`);
      continue;
    }
    const value = (raw ?? "").trim();
    if (!value) {
      out[field.column] = null;
      continue;
    }
    if (value.length > field.max) errors.push(`${field.label}: ${field.max}자 이하`);
    const problem = field.check?.(value);
    if (problem) errors.push(`${field.label}: ${problem}`);
    out[field.column] = field.column === "business_number" ? value.replace(/^(\d{3})-?(\d{2})-?(\d{5})$/, "$1-$2-$3") : value;
  }
  if (errors.length) throw new HttpError(422, "고객 정보 검증 실패", errors);
  return out;
}

export async function getCustomerRow(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first<CustomerRow>();
  if (!row) throw new HttpError(404, `고객이 없습니다: ${id}`);
  return row;
}

export async function createCustomer(db: D1Database, body: Record<string, unknown>) {
  const columns = columnsFrom(body);
  if (!columns.name) throw new HttpError(422, "고객 정보 검증 실패", ["업체명: 필수"]);
  const id = crypto.randomUUID();
  const keys = Object.keys(columns) as (keyof CustomerRow)[];
  await db
    .prepare(
      `INSERT INTO customers (id, ${keys.join(", ")}, status, created_at, updated_at) VALUES (?, ${keys.map(() => "?").join(", ")}, 'active', ?, ?)`,
    )
    .bind(id, ...keys.map((k) => columns[k]), now(), now())
    .run();
  return getCustomerRow(db, id);
}

export async function updateCustomer(db: D1Database, id: string, body: Record<string, unknown>) {
  await getCustomerRow(db, id);
  const columns = columnsFrom(body);
  if ("name" in columns && !columns.name) throw new HttpError(422, "고객 정보 검증 실패", ["업체명: 필수"]);
  const keys = Object.keys(columns) as (keyof CustomerRow)[];
  if (keys.length) {
    await db
      .prepare(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => columns[k]), now(), id)
      .run();
  }
  return getCustomerRow(db, id);
}

/** Monthly billing of a subscription that is billed or paying (yearly spread over 12 months). */
const MONTHLY_SQL = `CASE WHEN sub.status IN ('trial', 'cancelled') THEN 0 WHEN sub.cycle = 'yearly' THEN sub.amount / 12.0 ELSE sub.amount END`;

export async function listCustomers(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT c.*, COUNT(s.id) AS site_count, CAST(ROUND(COALESCE(SUM(${MONTHLY_SQL}), 0)) AS INTEGER) AS monthly_total,
              GROUP_CONCAT(${BUSINESS_NAME_SQL("s.id", "s.published_version_id")}, ', ') AS site_names,
              SUM(CASE WHEN sub.status IN ('awaiting', 'overdue', 'suspended') THEN 1 ELSE 0 END) AS attention
       FROM customers c LEFT JOIN sites s ON s.customer_id = c.id LEFT JOIN subscriptions sub ON sub.site_id = s.id
       GROUP BY c.id ORDER BY c.updated_at DESC`,
    )
    .all<CustomerRow & { site_count: number; monthly_total: number; site_names: string | null; attention: number }>();
  return results;
}

/** Customer with every site, its subscription and all payments. */
export async function customerDetail(db: D1Database, id: string) {
  const customer = await getCustomerRow(db, id);
  const { results: sites } = await db
    .prepare(
      `SELECT s.id, s.slug, s.status, s.suspend_reason, s.cancelled_at, s.published_version_id, ${BUSINESS_NAME_SQL("s.id", "s.published_version_id")} AS business_name
       FROM sites s WHERE s.customer_id = ? ORDER BY s.created_at`,
    )
    .bind(id)
    .all<{ id: string }>();
  const payments: PaymentRow[] = [];
  const withBilling = [];
  for (const site of sites) {
    withBilling.push({ ...site, subscription: await subscriptionOf(db, site.id) });
    payments.push(...(await sitePayments(db, site.id)));
  }
  payments.sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  return { customer, sites: withBilling, payments, unlinkedMatches: await unlinkedMatches(db, customer) };
}

/**
 * Sites without a customer whose latest draft has this customer's phone or business number:
 * offered on the customer's page so their sites and payments add up.
 */
async function unlinkedMatches(db: D1Database, customer: CustomerRow) {
  const isOwner = sameOwner(customer.phone, customer.business_number);
  if (!isOwner) return [];
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, ${BUSINESS_NAME_SQL("s.id", "s.published_version_id")} AS business_name,
              (SELECT v.config FROM site_versions v WHERE v.site_id = s.id ORDER BY v.number DESC LIMIT 1) AS config
       FROM sites s WHERE s.customer_id IS NULL AND s.cancelled_at IS NULL ORDER BY s.created_at`,
    )
    .all<{ id: string; slug: string; business_name: string | null; config: string | null }>();
  return results
    .filter(({ config }) => {
      const business = config ? (JSON.parse(config) as { business?: { phone?: string; businessNumber?: string } }).business : undefined;
      return isOwner(business?.phone, business?.businessNumber);
    })
    .map(({ config: _config, ...site }) => site);
}

/** PATCH /sites/:id {customerId}: attach (or detach with null) a site to a customer. */
export async function linkSite(db: D1Database, siteId: string, customerId: unknown) {
  if (customerId !== null && typeof customerId !== "string") throw new HttpError(422, "customerId는 문자열 또는 null");
  if (customerId) await getCustomerRow(db, customerId);
  await db.prepare("UPDATE sites SET customer_id = ?, updated_at = ? WHERE id = ?").bind(customerId, now(), siteId).run();
}

const digitsOf = (value: unknown) => (typeof value === "string" ? value.replace(/[^\d]/g, "") : "");

/**
 * "Same owner" test for one phone and business number: a full phone (9+ digits) or a full
 * business number (10 digits) that matches, hyphens ignored. Null when neither is complete.
 */
function sameOwner(phone: unknown, businessNumber: unknown) {
  const p = digitsOf(phone);
  const n = digitsOf(businessNumber);
  if (p.length < 9 && n.length !== 10) return null;
  return (otherPhone: unknown, otherNumber: unknown) => (p.length >= 9 && digitsOf(otherPhone) === p) || (n.length === 10 && digitsOf(otherNumber) === n);
}

/** Customers matching a name, owner, phone or business number (agents look before creating). */
export async function findCustomers(db: D1Database, search: string) {
  const q = search.trim().toLowerCase();
  const digits = digitsOf(search);
  const all = await listCustomers(db);
  return all.filter(
    (c) =>
      (q && [c.name, c.contact_name, c.email].some((v) => v?.toLowerCase().includes(q))) ||
      (digits.length >= 4 && [c.phone, c.business_number].some((v) => digitsOf(v).includes(digits))),
  );
}

/** Existing customers with the same phone or business number: the same owner twice. */
export async function duplicatesOf(db: D1Database, body: Record<string, unknown>) {
  const isOwner = sameOwner(body.phone, body.businessNumber);
  if (!isOwner) return [];
  return (await listCustomers(db)).filter((c) => isOwner(c.phone, c.business_number));
}

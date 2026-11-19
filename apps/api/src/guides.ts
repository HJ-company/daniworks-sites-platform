import { serviceSiteConfigSchema } from "@sites/schema";
import { serviceLocalSkeleton } from "@sites/renderer";
import { z } from "zod";
import type { Env } from "./env.js";
import { GUIDE_DEFAULTS, type GuideDefault } from "./guide-defaults.js";
import { HttpError } from "./http.js";

/**
 * Authoring guides for the AI tools (M4 4-E). Stored guides are markdown split into `## `
 * sections, versioned on every edit. One more guide, the site config schema, is generated
 * from the code that validates configs, so it can never drift and is read-only.
 */
export const SCHEMA_SLUG = "schema-site-config";
const KINDS = ["policy", "industry", "design", "writing"] as const;
const SCOPES = ["operator", "customer"] as const;

const now = () => new Date().toISOString();

interface GuideRow {
  slug: string;
  title: string;
  kind: string;
  scope: string;
  summary: string;
  version: number;
  updated_at: string;
}

/** Copies the shipped defaults into D1 once; existing guides (and their edits) are kept. */
async function seed(env: Env) {
  const { results } = await env.DB.prepare("SELECT slug FROM guides").all<{ slug: string }>();
  const have = new Set(results.map((r) => r.slug));
  const missing = GUIDE_DEFAULTS.filter((g) => !have.has(g.slug));
  if (!missing.length) return;
  const at = now();
  await env.DB.batch(
    missing.flatMap((g: GuideDefault) => [
      env.DB.prepare("INSERT OR IGNORE INTO guides (slug, title, kind, scope, summary, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind(
        g.slug,
        g.title,
        g.kind,
        g.scope,
        g.summary,
        at,
        at,
      ),
      env.DB.prepare("INSERT OR IGNORE INTO guide_versions (slug, version, body, author, note, created_at) VALUES (?, 1, ?, '기본값', '플랫폼 기본 지침', ?)").bind(
        g.slug,
        g.body,
        at,
      ),
    ]),
  );
}

/** The generated schema guide: JSON Schema of the site config plus the placeholder skeleton. */
function schemaGuide() {
  const schema = z.toJSONSchema(serviceSiteConfigSchema, { io: "input", unrepresentable: "any" });
  const body = [
    "# 사이트 설정 스키마 (service-local, version 2)",
    "",
    "코드에서 자동으로 만든 문서다. 수정할 수 없다. 저장 전 site_validate로 같은 규칙을 검사한다.",
    "",
    "## JSON Schema",
    "",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "",
    "## 뼈대(자리표시자)",
    "",
    "```json",
    JSON.stringify(serviceLocalSkeleton, null, 2),
    "```",
  ].join("\n");
  return { slug: SCHEMA_SLUG, title: "사이트 설정 스키마", kind: "schema", scope: "operator", summary: "설정 JSON의 필드·제약(코드 생성, 읽기 전용)", version: 0, body };
}

export async function listGuides(env: Env) {
  await seed(env);
  const { results } = await env.DB.prepare("SELECT slug, title, kind, scope, summary, version, updated_at FROM guides ORDER BY kind, slug").all<GuideRow>();
  const { body: _body, ...schema } = schemaGuide();
  return [{ ...schema, readOnly: true }, ...results.map((g) => ({ ...g, readOnly: false }))];
}

/** Current version numbers of every stored guide: what an AI-saved version was written against. */
export async function guideSnapshot(env: Env): Promise<Record<string, number>> {
  await seed(env);
  const { results } = await env.DB.prepare("SELECT slug, version FROM guides").all<{ slug: string; version: number }>();
  return Object.fromEntries(results.map((g) => [g.slug, g.version]));
}

/** `## ` sections of a markdown body; text before the first section is the intro. */
export function sections(body: string) {
  const out: { heading: string; text: string }[] = [];
  let current = { heading: "", text: "" };
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (current.heading || current.text.trim()) out.push(current);
      current = { heading: line.slice(3).trim(), text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.heading || current.text.trim()) out.push(current);
  return out;
}

async function storedGuide(env: Env, slug: string, version?: number) {
  await seed(env);
  const guide = await env.DB.prepare("SELECT slug, title, kind, scope, summary, version, updated_at FROM guides WHERE slug = ?").bind(slug).first<GuideRow>();
  if (!guide) throw new HttpError(404, `지침이 없습니다: ${slug}. guide_list로 목록을 보세요`);
  const row = await env.DB.prepare("SELECT body, author, note, created_at FROM guide_versions WHERE slug = ? AND version = ?")
    .bind(slug, version ?? guide.version)
    .first<{ body: string; author: string | null; note: string | null; created_at: string }>();
  if (!row) throw new HttpError(404, `버전이 없습니다: ${slug} v${version}`);
  return { ...guide, version: version ?? guide.version, ...row };
}

/** A guide, or only the sections that mention the query's words (headings and text). */
export async function getGuide(env: Env, slug: string, query?: string, version?: number) {
  const guide = slug === SCHEMA_SLUG ? schemaGuide() : await storedGuide(env, slug, version);
  const words = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return { ...guide, matched: null };
  const found = sections(guide.body).filter((s) => words.some((w) => s.text.toLowerCase().includes(w)));
  return { ...guide, body: found.map((s) => s.text).join("\n") || "(일치하는 섹션이 없습니다. query 없이 전체를 읽으세요)", matched: found.map((s) => s.heading) };
}

export async function guideVersions(env: Env, slug: string) {
  await storedGuide(env, slug);
  const { results } = await env.DB.prepare("SELECT version, author, note, created_at FROM guide_versions WHERE slug = ? ORDER BY version DESC").bind(slug).all();
  return results;
}

function text(value: unknown, label: string, max: number, required = true): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(422, `${label}이(가) 필요합니다`);
    return null;
  }
  if (typeof value !== "string" || value.length > max) throw new HttpError(422, `${label}은(는) ${max}자 이하 문자열이어야 합니다`);
  return value;
}

export async function createGuide(
  env: Env,
  input: { slug?: unknown; title?: unknown; kind?: unknown; scope?: unknown; summary?: unknown; body?: unknown },
  author: string,
) {
  await seed(env);
  const slug = text(input.slug, "slug", 60)!;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug === SCHEMA_SLUG) throw new HttpError(422, "slug는 영문 소문자·숫자·하이픈");
  if (!KINDS.includes(input.kind as (typeof KINDS)[number])) throw new HttpError(422, `kind는 ${KINDS.join("·")} 중 하나`);
  const scope = input.scope === undefined ? "operator" : input.scope;
  if (!SCOPES.includes(scope as (typeof SCOPES)[number])) throw new HttpError(422, "scope는 operator 또는 customer");
  const at = now();
  const [created] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guides (slug, title, kind, scope, summary, version, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM guides WHERE slug = ?)",
    ).bind(slug, text(input.title, "title", 100), input.kind, scope, text(input.summary, "summary", 200), at, at, slug),
    env.DB.prepare(
      "INSERT INTO guide_versions (slug, version, body, author, note, created_at) SELECT ?, 1, ?, ?, '새 지침', ? WHERE (SELECT created_at FROM guides WHERE slug = ?) = ?",
    ).bind(slug, text(input.body, "body", 50_000), author, at, slug, at),
  ]);
  if (created?.meta.changes !== 1) throw new HttpError(409, `이미 있는 slug입니다: ${slug}`);
  return storedGuide(env, slug);
}

/**
 * New version of a guide. With `section`, only that `## ` section is replaced (or appended if it
 * does not exist); `body` is its new text, with or without the heading line. Without it, `body`
 * replaces the whole guide. Refused if someone else saved a version since `baseVersion`.
 */
export async function updateGuide(
  env: Env,
  input: { slug?: unknown; section?: unknown; body?: unknown; note?: unknown; baseVersion?: unknown },
  author: string,
) {
  const slug = text(input.slug, "slug", 60)!;
  if (slug === SCHEMA_SLUG) throw new HttpError(409, "스키마 문서는 코드에서 만들어져 고칠 수 없습니다");
  const current = await storedGuide(env, slug);
  if (input.baseVersion !== undefined && input.baseVersion !== current.version) {
    throw new HttpError(409, `다른 사람이 먼저 고쳤습니다(현재 v${current.version}). guide_get으로 다시 읽고 고치세요`);
  }
  const body = text(input.body, "body", 50_000)!;
  const section = text(input.section, "section", 100, false);
  let next = body;
  if (section) {
    const parts = sections(current.body);
    const replacement = body.startsWith("## ") ? `${body.trimEnd()}\n\n` : `## ${section}\n\n${body.trimEnd()}\n\n`;
    const at = parts.findIndex((s) => s.heading === section);
    if (at === -1) parts.push({ heading: section, text: replacement });
    else parts[at] = { heading: section, text: replacement };
    next = parts.map((s) => s.text).join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  if (next === current.body) return { ...current, unchanged: true };
  const version = current.version + 1;
  const at = now();
  // Conditional on the version read: two simultaneous edits never both become v+1.
  const [moved] = await env.DB.batch([
    env.DB.prepare("UPDATE guides SET version = ?, updated_at = ? WHERE slug = ? AND version = ?").bind(version, at, slug, current.version),
    env.DB.prepare(
      "INSERT INTO guide_versions (slug, version, body, author, note, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT version FROM guides WHERE slug = ?) = ? AND (SELECT updated_at FROM guides WHERE slug = ?) = ?",
    ).bind(slug, version, next, author, text(input.note, "note", 200, false), at, slug, version, slug, at),
  ]);
  if (moved?.meta.changes !== 1) throw new HttpError(409, "다른 사람이 동시에 고쳤습니다. guide_get으로 다시 읽고 고치세요");
  return { ...(await storedGuide(env, slug)), unchanged: false };
}

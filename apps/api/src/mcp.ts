import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  parseSiteConfig,
  presets,
  SAMPLE_PHOTOS,
  SiteConfigError,
  serviceLocalGuide,
  serviceLocalSkeleton,
} from "@sites/renderer";
import { z } from "zod";
import { uploadAsset } from "./assets.js";
import { draftLink, issueDraftLink } from "./draft-links.js";
import { actorName, audit, type Actor } from "./auth.js";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { publish, rollback } from "./publish.js";
import { addDraft, createSiteFromInput, findSite, previewUrl } from "./sites.js";
import { listVersions } from "./store.js";

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (value: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

/** API errors become tool errors the agent can act on (validation details keep their paths). */
async function run(fn: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof HttpError || error instanceof SiteConfigError) {
      const details = error instanceof HttpError ? error.details : error.errors;
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message, details }, null, 2) }],
        isError: true,
      };
    }
    throw error;
  }
}

const configSchema = z
  .record(z.string(), z.unknown())
  .describe("사이트 설정(version 2, service-local). 형식과 작성 지침은 template_get으로 먼저 확인한다.");
const siteRef = z.string().min(1).describe("사이트 id 또는 slug");

const TEMPLATES = [
  {
    id: "service-local",
    name: "레슨·교육·출장 서비스",
    presets: Object.entries(presets).map(([id, spec]) => ({ id, label: spec.label, defaultPalette: spec.defaultPalette })),
  },
];

function createServer(env: Env, actor: Actor) {
  const server = new McpServer({ name: "dsites", version: "1.0.0" });

  server.registerTool(
    "template_list",
    { description: "사용할 수 있는 업종 템플릿과 preset 목록." },
    async () => ok({ templates: TEMPLATES, palettes: ["pine", "ocean", "clay"] }),
  );

  server.registerTool(
    "template_get",
    {
      description: "업종 템플릿의 작성 지침, 샘플 사진 키, 설정 뼈대(자리표시자). 사이트를 만들기 전에 읽는다.",
      inputSchema: z.object({ templateId: z.literal("service-local") }),
    },
    async () =>
      ok({
        templateId: "service-local",
        guide: serviceLocalGuide,
        samplePhotos: SAMPLE_PHOTOS.map((name) => `t:${name}`),
        // Placeholders only: real fixtures would leak one business's copy into another's site.
        skeleton: serviceLocalSkeleton,
      }),
  );

  server.registerTool(
    "site_validate",
    {
      description: "설정을 저장하지 않고 검증한다. 오류는 경로별로 돌려준다(예: content.services.items).",
      inputSchema: z.object({ config: configSchema }),
    },
    async ({ config }) => {
      const result = parseSiteConfig(config);
      return ok(result.ok ? { valid: true, errors: [] } : { valid: false, errors: result.errors });
    },
  );

  server.registerTool(
    "site_create",
    {
      description: "새 사이트를 만든다(버전 1, 초안). 공개되지 않으며 프리뷰 URL을 돌려준다.",
      inputSchema: z.object({ config: configSchema }),
    },
    async ({ config }) =>
      run(async () => {
        const created = await createSiteFromInput(env, config, "ai", undefined, actorName(actor));
        const versions = (await listVersions(env.DB, created.siteId)) as { preview_token: string }[];
        return { ...created, previewUrl: previewUrl(env, versions[0]!.preview_token) };
      }),
  );

  server.registerTool(
    "site_get",
    {
      description: "사이트 상태, 버전 목록과 최신 버전의 설정.",
      inputSchema: z.object({ site: siteRef }),
    },
    async ({ site: ref }) =>
      run(async () => {
        const site = await findSite(env, ref);
        const versions = (await listVersions(env.DB, site.id)) as { id: string; preview_token: string }[];
        const latest = await env.DB.prepare("SELECT config FROM site_versions WHERE site_id = ? ORDER BY number DESC LIMIT 1")
          .bind(site.id)
          .first<{ config: string }>();
        return {
          site,
          versions: versions.map((v) => ({ ...v, previewUrl: previewUrl(env, v.preview_token) })),
          latestConfig: latest ? JSON.parse(latest.config) : null,
        };
      }),
  );

  server.registerTool(
    "site_update_draft",
    {
      description: "수정한 설정을 새 초안 버전으로 저장한다. 공개 사이트는 바뀌지 않는다. slug는 바꿀 수 없다.",
      inputSchema: z.object({ site: siteRef, config: configSchema, note: z.string().max(200).optional() }),
    },
    async ({ site: ref, config, note }) =>
      run(async () => {
        const site = await findSite(env, ref);
        const draft = await addDraft(env, site, config, "ai", note ?? null, actorName(actor));
        const token = await env.DB.prepare("SELECT preview_token FROM site_versions WHERE id = ?")
          .bind(draft.versionId)
          .first<{ preview_token: string }>();
        return { ...draft, previewUrl: previewUrl(env, token!.preview_token) };
      }),
  );

  server.registerTool(
    "site_preview_url",
    {
      description: "버전의 프리뷰 URL(검색엔진 차단). versionId를 생략하면 최신 버전.",
      inputSchema: z.object({ site: siteRef, versionId: z.string().optional() }),
    },
    async ({ site: ref, versionId }) =>
      run(async () => {
        const site = await findSite(env, ref);
        const row = await env.DB.prepare(
          versionId
            ? "SELECT id, number, preview_token FROM site_versions WHERE site_id = ? AND id = ?"
            : "SELECT id, number, preview_token FROM site_versions WHERE site_id = ? ORDER BY number DESC LIMIT 1",
        )
          .bind(...(versionId ? [site.id, versionId] : [site.id]))
          .first<{ id: string; number: number; preview_token: string }>();
        if (!row) throw new HttpError(404, "버전이 없습니다");
        return { versionId: row.id, number: row.number, previewUrl: previewUrl(env, row.preview_token) };
      }),
  );

  server.registerTool(
    "site_preview_link",
    {
      description:
        "사장님께 카톡으로 보낼 시안 링크. 사이트당 하나이고 항상 최신 버전을 보여주므로 시안을 고쳐도 링크는 그대로다. 30일 동안 열린다. " +
        "링크가 없거나 만료됐으면 새로 만든다. reissue=true면 새 링크로 바꾸고 예전 링크는 막는다. site_preview_url은 운영자 검수용 버전 링크다.",
      inputSchema: z.object({ site: siteRef, reissue: z.boolean().optional() }),
    },
    async ({ site: ref, reissue }) =>
      run(async () => {
        const site = await findSite(env, ref);
        const current = draftLink(env, site);
        const link = !reissue && current && !current.expired ? current : await issueDraftLink(env, site);
        return { url: link.url, expiresAt: link.expiresAt, reissued: link !== current };
      }),
  );

  server.registerTool(
    "site_publish",
    {
      description: "버전을 공개한다(생략하면 최신 버전). 운영자 검수를 거친 뒤에만 호출한다. 전 세계 반영까지 약 30초.",
      inputSchema: z.object({ site: siteRef, versionId: z.string().optional() }),
    },
    async ({ site: ref, versionId }) => run(async () => ({ ...(await publish(env, await findSite(env, ref), versionId)) })),
  );

  server.registerTool(
    "site_rollback",
    {
      description: "예전에 게시했던 버전으로 되돌린다. 다시 렌더하지 않는다.",
      inputSchema: z.object({ site: siteRef, versionId: z.string() }),
    },
    async ({ site: ref, versionId }) => run(async () => ({ ...(await rollback(env, await findSite(env, ref), versionId)) })),
  );

  server.registerTool(
    "asset_upload",
    {
      description:
        "사진을 올리고 설정에 넣을 key·width·height를 돌려준다. url(https, 블로그 사진 등) 또는 base64 중 하나. 3MP 이하만 받는다.",
      inputSchema: z.object({
        site: siteRef,
        url: z.string().url().optional(),
        base64: z.string().max(8_000_000).optional(),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
      }),
    },
    async ({ site: ref, url, base64, contentType }) =>
      run(async () => {
        const site = await findSite(env, ref);
        if (!url === !base64) throw new HttpError(400, "url과 base64 중 하나만 주세요");
        const request = url
          ? new Request("https://internal/upload", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ url }),
            })
          : new Request("https://internal/upload", {
              method: "POST",
              headers: { "content-type": contentType ?? "application/octet-stream" },
              body: Uint8Array.from(atob(base64!), (c) => c.charCodeAt(0)),
            });
        return { ...(await uploadAsset(env, site, request)) };
      }),
  );

  return server;
}

/** Tools that only read: not worth an audit row. */
const READ_ONLY = new Set(["template_list", "template_get", "site_get", "site_validate", "site_preview_url"]);

/** JSON-RPC messages in an MCP HTTP response: a JSON body, or server-sent events. */
type RpcMessage = { id?: unknown; error?: unknown; result?: { isError?: boolean; structuredContent?: { siteId?: unknown }; content?: { text?: string }[] } };

/** The site a successful site_create made, from its result. */
function createdSite(answer: RpcMessage | undefined): string | null {
  const structured = answer?.result?.structuredContent?.siteId;
  if (typeof structured === "string") return structured;
  try {
    const parsed = JSON.parse(answer?.result?.content?.[0]?.text ?? "{}") as { siteId?: unknown };
    return typeof parsed.siteId === "string" ? parsed.siteId : null;
  } catch {
    return null;
  }
}

function rpcMessages(contentType: string, body: string): RpcMessage[] {
  const texts = contentType.includes("text/event-stream")
    ? body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    : [body];
  return texts.flatMap((text) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      return (Array.isArray(parsed) ? parsed : [parsed]) as RpcMessage[];
    } catch {
      return [];
    }
  });
}

/**
 * `/mcp` endpoint. The caller is authenticated (Authentik operator or script); a fresh server
 * serves each request. Changing tool calls are audited with the person behind them and their
 * real outcome: a call is refused unless its JSON-RPC answer is a result without `isError`
 * (tool refusals, input validation and unknown tools all arrive over HTTP 200).
 */
export async function handleMcp(request: Request, env: Env, actor: Actor) {
  const calls: { id: unknown; name: string; site: string | null }[] = [];
  if (request.method === "POST") {
    try {
      const body = (await request.clone().json()) as unknown;
      for (const message of Array.isArray(body) ? body : [body]) {
        const m = message as { id?: unknown; method?: string; params?: { name?: string; arguments?: { site?: unknown } } };
        if (m?.method === "tools/call" && m.params?.name && !READ_ONLY.has(m.params.name)) {
          calls.push({ id: m.id, name: m.params.name, site: typeof m.params.arguments?.site === "string" ? m.params.arguments.site : null });
        }
      }
    } catch {
      // Not JSON: the MCP handler answers with the protocol error.
    }
  }
  const streamed = await createMcpHandler(() => createServer(env, actor)).fetch(request);
  if (!calls.length) return streamed;
  // The body may still be streaming while the tool runs: read it to the end before auditing.
  const body = await streamed.text();
  const answers = rpcMessages(streamed.headers.get("content-type") ?? "", body);
  for (const call of calls) {
    const answer = answers.find((m) => m.id === call.id);
    const succeeded = streamed.ok && answer !== undefined && !answer.error && answer.result?.isError !== true;
    // Tools take a slug or an id; the audit keys on the id so the site's history shows the call.
    // A new site's id comes from the creation result.
    const siteId =
      call.name === "site_create" && succeeded
        ? createdSite(answer)
        : call.site
          ? ((await env.DB.prepare("SELECT id FROM sites WHERE slug = ?1 OR id = ?1").bind(call.site).first<{ id: string }>())?.id ?? null)
          : null;
    await audit(env, actor, { action: `MCP ${call.name}`, siteId, target: call.site, status: streamed.ok ? (succeeded ? 200 : 422) : streamed.status });
  }
  return new Response(body, streamed);
}

/**
 * Latest blog posts: RSS parsing (api cron) and card markup (router, at request time). Pure and
 * dependency-free so the router can import it without pulling in React.
 */
export interface BlogPost {
  title: string;
  link: string;
  /** ISO date. */
  date: string | null;
  summary: string;
  image: string | null;
}

export interface BlogFeed {
  /** Blog URL these posts came from; the router shows them only under the same URL. */
  source: string;
  fetchedAt: string;
  posts: BlogPost[];
}

export const BLOG_POSTS = 3;

/** `https://blog.naver.com/<id>` → `<base>/<id>.xml` (base: `https://rss.blog.naver.com`). */
export function naverRssUrl(blogUrl: string, base = "https://rss.blog.naver.com"): string | null {
  const id = blogUrl.match(/^https:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  return id ? `${base}/${id}.xml` : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    });
}

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Newest posts from a Naver blog RSS document. Only https links and pstatic images survive. */
export function parseNaverRss(xml: string, limit = BLOG_POSTS): BlogPost[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const posts: BlogPost[] = [];
  for (const item of items) {
    const title = text(decode(tag(item, "title")));
    const link = decode(tag(item, "link")).trim();
    if (!title || !/^https:\/\/(m\.)?blog\.naver\.com\//.test(link)) continue;
    const description = decode(tag(item, "description"));
    const image = description.match(/https:\/\/(?:blogthumb|postfiles)\.pstatic\.net\/[^"'\s<>]+/)?.[0] ?? null;
    const pub = Date.parse(decode(tag(item, "pubDate")));
    const summary = text(description);
    posts.push({
      title: title.slice(0, 120),
      link: link.replace(/\?.*$/, ""),
      date: Number.isFinite(pub) ? new Date(pub).toISOString() : null,
      summary: summary.length > 110 ? `${summary.slice(0, 110)}…` : summary,
      image,
    });
    if (posts.length >= limit) break;
  }
  return posts;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, ".");

/**
 * Card markup the router injects into `[data-blog-feed]`. Naver images refuse foreign
 * referrers but serve requests without one, hence `referrerpolicy="no-referrer"`.
 */
export function blogCardsHtml(posts: BlogPost[]): string {
  if (!posts.length) return "";
  const cards = posts
    .map(
      (post) => `<li class="sites-blog-card overflow-hidden rounded-xl border border-black/10 bg-white">
<a href="${escape(post.link)}" target="_blank" rel="noopener" class="block h-full">
${post.image ? `<img src="${escape(post.image)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" width="365" height="365" class="aspect-[4/3] w-full object-cover">` : ""}
<div class="p-4">
${post.date ? `<p class="text-xs text-[var(--color-text-muted)]">${kstDate(post.date)}</p>` : ""}
<p class="mt-1 font-semibold leading-snug text-[var(--color-text)]">${escape(post.title)}</p>
${post.summary ? `<p class="mt-2 line-clamp-2 text-sm text-[var(--color-text-muted)]">${escape(post.summary)}</p>` : ""}
</div>
</a>
</li>`,
    )
    .join("");
  return `<ul class="grid gap-4 sm:grid-cols-3">${cards}</ul>`;
}

/**
 * Latest-posts section. The page is static; the router fills `[data-blog-feed]` from the KV
 * cache at request time, so new posts appear without republishing. The inner HTML is set with
 * dangerouslySetInnerHTML, which hydration does not compare, so the injected cards stay.
 */
export function BlogFeed({ blogUrl }: { blogUrl: string }) {
  return (
    <section id="blog" className="sites-blog px-5 py-16 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-bold md:text-3xl">블로그 소식</h2>
          <a href={blogUrl} target="_blank" rel="noopener" className="shrink-0 text-sm font-semibold text-[var(--color-primary)]">
            블로그에서 더 보기
          </a>
        </div>
        {/* The URL is the feed's identity: the router fills posts only from the same blog. */}
        <div data-blog-feed={blogUrl} dangerouslySetInnerHTML={{ __html: "" }} />
      </div>
    </section>
  );
}

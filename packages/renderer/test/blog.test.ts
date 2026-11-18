import { describe, expect, it } from "vitest";
import { blogCardsHtml, naverRssUrl, parseNaverRss } from "../src/platform/blog.js";

const rss = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title><![CDATA[예시 블로그]]></title>
<item><title><![CDATA[첫 글 &amp; <b>소식</b>]]></title><link><![CDATA[https://blog.naver.com/example/111?fromRss=true]]></link>
<description><![CDATA[<img src="https://blogthumb.pstatic.net/a/b.jpg?type=s3"> 본문 <b>요약</b> 입니다.]]></description><pubDate>Tue, 17 Nov 2026 10:00:00 +0900</pubDate></item>
<item><title>나쁜 링크</title><link>javascript:alert(1)</link><description>x</description></item>
<item><title><![CDATA["따옴표" <script>alert(1)</script>]]></title><link>https://blog.naver.com/example/222</link><description><![CDATA[이미지 없음]]></description><pubDate>Mon, 16 Nov 2026 09:00:00 +0900</pubDate></item>
</channel></rss>`;

describe("blog", () => {
  it("maps blog URLs to RSS", () => {
    expect(naverRssUrl("https://blog.naver.com/jefes_fc")).toBe("https://rss.blog.naver.com/jefes_fc.xml");
    expect(naverRssUrl("https://m.blog.naver.com/x/", "http://mock")).toBe("http://mock/x.xml");
    expect(naverRssUrl("https://example.com/blog")).toBeNull();
  });

  it("parses posts, skipping unsafe links and stripping markup", () => {
    const posts = parseNaverRss(rss);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      title: "첫 글 & 소식",
      link: "https://blog.naver.com/example/111",
      image: "https://blogthumb.pstatic.net/a/b.jpg?type=s3",
      summary: "본문 요약 입니다.",
      date: "2026-11-17T01:00:00.000Z",
    });
    expect(posts[1]?.image).toBeNull();
  });

  it("escapes everything in card markup and keeps images referrer-free", () => {
    const html = blogCardsHtml(parseNaverRss(rss));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;따옴표&quot; alert(1)");
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain("2026.11.17");
    expect(blogCardsHtml([])).toBe("");
  });
});

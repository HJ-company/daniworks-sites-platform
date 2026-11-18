/**
 * Naver blog RSS gives `blogthumb.pstatic.net/...?type=s3` thumbnails (365×365). The same path
 * on `postfiles.pstatic.net` with `type=w966` serves the uploaded size (measured 900×675).
 */
export function normalizeNaverImage(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname !== "blogthumb.pstatic.net" && parsed.hostname !== "postfiles.pstatic.net") return url;
  parsed.hostname = "postfiles.pstatic.net";
  parsed.searchParams.set("type", "w966");
  return parsed.toString();
}

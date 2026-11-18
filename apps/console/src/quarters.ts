/** Last eight quarters, newest first, by Korean date. */
export function recentQuarters(now = new Date()): string[] {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  let year = kst.getUTCFullYear();
  let q = Math.floor(kst.getUTCMonth() / 3) + 1;
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(`${year}-Q${q}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

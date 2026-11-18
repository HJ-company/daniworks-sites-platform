// Runs every verification script in order and prints one summary. Docker:
// docker compose run --rm verify node scripts/verify-all.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const steps = [
  ["m1", "verify-m1.mjs"],
  ["m2-template", "verify-m2-template.mjs"],
  ["m2-assets", "verify-m2-assets.mjs"],
  ["m2-router", "verify-m2-router.mjs"],
  ["m2-inquiry", "verify-m2-inquiry.mjs"],
  ["m2-track", "verify-m2-track.mjs"],
  ["m2-mcp", "verify-m2-mcp.mjs"],
  ["m2-domains", "verify-m2-domains.mjs"],
  ["m2-console", "verify-m2-console.mjs"],
  ["m3-blog", "verify-m3-blog.mjs"],
  ["m3-reports", "verify-m3-reports.mjs"],
  ["m3-republish", "verify-m3-republish.mjs"],
];
const only = process.argv.slice(2);
const summary = [];
for (const [step, script] of steps) {
  if (only.length && !only.includes(step)) continue;
  const started = Date.now();
  // A stale results file from an earlier run must never stand in for this one.
  rmSync(`evidence/${step}/results.json`, { force: true });
  const run = spawnSync("node", [`scripts/${script}`], { encoding: "utf8", env: process.env });
  const results = (() => {
    try {
      return JSON.parse(readFileSync(`evidence/${step}/results.json`, "utf8")).results;
    } catch {
      return [];
    }
  })();
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  const ok = run.status === 0;
  summary.push({ step, ok, passed: results.length - failed.length, total: results.length, seconds: Math.round((Date.now() - started) / 1000), failed });
  console.log(`${ok ? "PASS" : "FAIL"} ${step} ${results.length - failed.length}/${results.length}${failed.length ? ` — ${failed.join("; ")}` : ""}`);
  if (!ok) console.log(run.stdout.slice(-1500), run.stderr.slice(-1500));
}
writeFileSync("evidence/verify-all.json", JSON.stringify({ at: new Date().toISOString(), summary }, null, 2));
const total = summary.reduce((n, s) => n + s.total, 0);
const passed = summary.reduce((n, s) => n + s.passed, 0);
console.log(`\n${passed}/${total} checks, ${summary.filter((s) => s.ok).length}/${summary.length} scripts`);
process.exit(summary.every((s) => s.ok) ? 0 : 1);

// Builds the template-versioned shared assets once: CSS, client bundle, template images.
// Per-site publishing only renders HTML against these.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist/public");
const assets = join(out, "_assets");
rmSync(out, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

execFileSync(
  join(root, "node_modules/.bin/tailwindcss"),
  ["-i", "src/styles.css", "-o", join(assets, "site.css"), "--minify"],
  { cwd: root, stdio: "inherit" },
);

await build({
  entryPoints: [join(root, "src/client.tsx")],
  outdir: assets,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const templatesDir = join(root, "node_modules/@dani-builder/site-templates");
cpSync(join(templatesDir, "assets/business-basic"), join(out, "site-templates"), { recursive: true });

for (const file of ["site.css", "client.js"]) {
  console.log(`${file}: ${(statSync(join(assets, file)).size / 1024).toFixed(1)} KiB`);
}
const chunks = readdirSync(join(assets, "chunks"));
const chunkKiB = chunks.reduce((sum, f) => sum + statSync(join(assets, "chunks", f)).size, 0) / 1024;
console.log(`chunks: ${chunks.length} files, ${chunkKiB.toFixed(0)} KiB (loaded on demand)`);

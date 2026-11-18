// Uploads the built shared assets (packages/renderer/dist/shared/<version>) through the API.
// Usage: API_URL=http://127.0.0.1:8788 ADMIN_TOKEN=... node scripts/upload-shared.mjs
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const api = process.env.API_URL ?? "http://127.0.0.1:8788";
const token = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const sharedRoot = "packages/renderer/dist/shared";
const types = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const files = walk(sharedRoot);
let bytes = 0;
for (const file of files) {
  const path = relative(sharedRoot, file);
  const body = readFileSync(file);
  bytes += body.byteLength;
  const res = await fetch(`${api}/admin/shared/${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": types[extname(file)] ?? "application/octet-stream" },
    body,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}
console.log(`uploaded ${files.length} files (${(bytes / 1024).toFixed(0)} KiB) to ${api}`);

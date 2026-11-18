import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: /api is proxied to the api Worker with the admin token added here, like the console
// Worker does in deployed environments. The browser never holds the token.
const api = process.env.API_URL ?? "http://127.0.0.1:8788";
const token = process.env.ADMIN_TOKEN ?? "dev-admin-token";

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST ?? "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: api,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: { authorization: `Bearer ${token}` },
      },
    },
  },
  // MUI X DataGrid alone is ~520 kB; it loads only on the list and inquiry screens.
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 600 },
});

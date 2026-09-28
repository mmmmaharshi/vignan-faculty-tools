import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Only for `bun run dev`. Production is `bun run build && bun server.ts`,
    // which is one process - see docs/adr/0001.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, host: true },
  // allowedHosts: true lets `vite preview` run behind tunnels/proxies for
  // local devs. Production is served by `serve` (see package.json start),
  // so this never applies to Railway.
  preview: { port: 4173, host: true, allowedHosts: true },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});

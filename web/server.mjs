// Minimal prod server for the web service:
//   * Serves the built SPA from ./dist with gzip + cache headers.
//   * Reverse-proxies /api/* and /ws/* to the API service.
//   * Falls back to index.html for unknown (non-/api) routes.
//
// We run this instead of `serve -s dist` so that the browser can call the
// API same-origin (no CORS dance) and so VITE_API_BASE can stay unset in
// the build -- the default "/api" prefix is forwarded server-side.
//
// Configuration (env):
//   PORT           -- listen port (Railway injects this).
//   API_BASE_URL   -- required. Upstream API root, e.g.
//                     https://ai-music-sentiment-api-production.up.railway.app
//                     Internal Railway hosts work too (http://api.railway.internal:8000).

import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL("./dist", import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const RAW_API = process.env.API_BASE_URL || "";
if (!RAW_API) {
  console.error("FATAL: API_BASE_URL is not set. /api/* requests would be served the SPA fallback.");
  process.exit(1);
}
const API_BASE = new URL(RAW_API);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function isApiPath(path) {
  return path === "/api" || path.startsWith("/api/") || path === "/ws" || path.startsWith("/ws/");
}

function proxy(req, res) {
  const target = new URL(req.url, API_BASE);
  // Preserve the path+query as-is; only swap host/port/protocol.
  target.host = API_BASE.host;
  target.protocol = API_BASE.protocol;
  target.port = API_BASE.port;
  if (API_BASE.pathname && API_BASE.pathname !== "/") {
    target.pathname = API_BASE.pathname.replace(/\/$/, "") + target.pathname;
  }

  const client = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers };
  // Strip hop-by-hop headers + hostname so the upstream sees the real target.
  delete headers.host;
  delete headers["content-length"];
  delete headers["accept-encoding"]; // let the upstream choose; we don't re-compress

  const upstream = client.request(
    target,
    { method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    console.error(`proxy error ${req.method} ${req.url} -> ${target.href}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_gateway", detail: err.message }));
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

function serveStatic(req, res) {
  // Default doc + SPA fallback share the same target.
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (rel === "/") rel = "/index.html";

  // Prevent path traversal.
  const filePath = resolve(join(DIST, rel));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(400).end("bad path");
    return;
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    stat = null;
  }

  const target = stat && stat.isFile() ? filePath : join(DIST, "index.html");
  const ext = extname(target).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";

  // Hashed assets get long cache; html is always fresh.
  const isHashed = target.includes(`${"/"}assets${"/"}`) && ext !== ".html";
  const headers = { "content-type": type };
  if (isHashed) headers["cache-control"] = "public, max-age=31536000, immutable";
  else headers["cache-control"] = "no-cache";

  res.writeHead(200, headers);
  createReadStream(target).pipe(res);
}

// Lazy-load https only if needed.
let https;
if (API_BASE.protocol === "https:") {
  https = await import("node:https");
}

const server = http.createServer((req, res) => {
  try {
    if (isApiPath(req.url || "")) return proxy(req, res);
    return serveStatic(req, res);
  } catch (err) {
    console.error("handler error:", err);
    if (!res.headersSent) res.writeHead(500).end("internal error");
  }
});

server.listen(PORT, () => {
  console.log(`web server listening on :${PORT}, proxying /api -> ${API_BASE.href}`);
});

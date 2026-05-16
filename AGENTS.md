# AGENTS.md

Guidance for AI coding agents working in this repo. Keep diffs small,
prefer editing over adding, and verify with the Make targets before
opening a PR. If something here contradicts a user request, follow the
user.

## Orient yourself in 30 seconds

- Three services + Postgres. See diagram in [README.md](./README.md).
- Pinned runtimes: `.python-version` (3.11), `.nvmrc` (20), `.tool-versions`.
- Canonical entry points:
  - `api/app/main.py` -- FastAPI app, routes in `api/app/routes/`.
  - `worker/schedule.py` -- APScheduler tasks (ingest/score/aggregate).
  - `web/src/main.ts` -- Vite app entry.
- Deploy: one `Dockerfile` + `railway.json` per service directory.

## Happy path (run before pushing)

```bash
make happy    # install api + web, typecheck, test, build, api import smoke
make lint     # eslint (web) + ruff (api + worker)
make test     # pytest (api) + vitest (web)
```

Heavier checks that don't run on every commit:

```bash
cd web && npm run test:e2e   # Playwright mobile smoke (needs chromium)
PROD_API_BASE=https://... make check-prod   # data-health probe
pre-commit install && pre-commit run -a     # hygiene + ruff + eslint + gitleaks
```

Add `make install-worker && make smoke-worker` only if you've touched
`worker/` -- it pulls torch (~1.5 GB). CI runs all three jobs on PRs.

## Invariants to preserve

Each item is a constraint plus the failure mode it prevents, so you
recognise regressions quickly.

- **Postgres driver = psycopg 3** (`psycopg[binary]`). Always go through
  `Settings.resolved_database_url`, which rewrites `postgresql://` to
  `postgresql+psycopg://`. Direct use of `settings.database_url` in a
  `create_engine` call fails with
  `ModuleNotFoundError: No module named 'psycopg2'`.
- **DB URL fallback order:** `DATABASE_URL` wins, falls back to
  `DATABASE_PUBLIC_URL`. Railway injects both; external envs (Factory
  cloud, CI, local dev) use the public one.
- **FastAPI response class:** keep `default_response_class=ORJSONResponse`.
  Setting it to `None` raises
  `TypeError: 'NoneType' object is not callable` on every request.
- **Railway `startCommand` with `${VAR}`:** wrap in `sh -c '...'`. Railway
  exec's the command without a shell, so unwrapped variables reach the
  process literally, e.g.
  `Invalid value for '--port': '${PORT:-8000}'`.
- **Railway config discovery:** `railway.json` must live in each service's
  Root Directory (`api/`, `worker/`, `web/`). Railway does not look in
  `infra/`; a stray config there silently falls through to Railpack and
  fails with "No start command detected".
- **Minimal comments:** match existing style; add comments only when
  behavior is non-obvious.

## Frontend invariants (web/)

Pitfalls that have bitten us before -- keep these in mind when editing
the Vite/TS app.

- **Don't wipe `.canvas` innerHTML** inside visualization constructors.
  `web/src/main.ts` puts a `.controls` chip (and quote cards) inside
  `<section class="canvas">`; `new Constellation(canvasEl)` must append
  its SVG alongside those siblings, not replace them. Covered by
  `web/src/viz/constellation.test.ts`.
- **First paint can be 0x0 on iOS Safari.** Any d3-rendered SVG inside
  the CSS-grid `1fr` canvas row must tolerate
  `getBoundingClientRect() == 0x0` on its initial render. The landing
  overlay fades for 800 ms while `begin()` synchronously calls
  `render()`, so the stage frequently isn't laid out yet. Use a fallback
  chain (svg rect -> container rect -> `window.inner*`) plus a
  `requestAnimationFrame` retry. Also attach a `ResizeObserver` so the
  visualization recovers when layout settles.
- **Timeline window changes should go through `Scrubber`.** Use
  `setWindow` / `shiftByDays` / `shiftByFraction` / `jumpToLatest`
  instead of ad-hoc `refresh(from, to)` calls so the scrubber overlay,
  date label, mode switching, and fetch lifecycle stay synchronized.
- **Category "public" may be near-empty** until the Reddit/Bluesky/
  NewsAPI ingest keys are configured. GDELT only emits `business`. If
  you're filtering the constellation to `public` and seeing nothing,
  check `/api/stats` before assuming a render bug.
- **`npm test` is part of the happy path.** Vitest + jsdom. Add new
  tests under `web/src/**/*.test.ts` and keep `npm run typecheck`
  green.
- **E2E lives in `web/e2e/`** (Playwright, iPhone 12 + Pixel 5). API
  calls must be stubbed with `page.route` so the test is hermetic; see
  `web/e2e/mobile-constellation.spec.ts`.
- **In mobile E2E, always complete the landing transition first.** Use a
  shared helper that clicks `Enter` and waits for `.landing` to be
  removed before interacting with stage controls; this avoids flake from
  overlay pointer interception and fade timing.
- **Ruff is scoped narrowly** (E/F/W only). Broadening it to `I/B/UP`
  is intentional future work -- do it in a dedicated cleanup PR so
  auto-fixes don't mask real review diffs.
- **Web runtime requires `API_BASE_URL`.** The production web service
  runs `node server.mjs` (see `web/server.mjs`), which serves the SPA
  and reverse-proxies `/api/*` and `/ws/*` to the API. If the env var
  is unset the server exits on start. In Railway this should point at
  the api service -- either its public hostname
  (`https://ai-music-sentiment-api-production.up.railway.app`) or,
  preferred, its private network URL (`http://<api>.railway.internal:$PORT`).
  **Do not** set `VITE_API_BASE` in the build: the frontend uses the
  default `/api` prefix and relies on the server-side proxy, which
  keeps requests same-origin and avoids CORS.

## Where to add things

- New API route -> `api/app/routes/<name>.py`, register in `api/app/main.py`.
- New ingest source -> `worker/sources/<name>.py`, wired up in
  `worker/ingest.py`.
- New env var -> `.env.example` + the matching `Settings` class in
  `api/app/config.py` or `worker/config.py`.
- New npm/pip dep -> update the matching lockfile/requirements; CI enforces
  install from lockfiles.

## PR body formatting (gh CLI)

- Prefer `--body-file <path>` when creating/editing PRs with `gh pr create`
  or `gh pr edit`.
- If passing `--body` inline, use real newlines (not escaped `\n` sequences),
  otherwise GitHub will render the backslash characters literally.

## Out of scope / do not change without asking

- Don't replace psycopg 3 with psycopg2 or asyncpg.
- Don't consolidate api+worker into one service (torch would bloat the
  public image).
- Don't add CI jobs that download HuggingFace models at test time; the
  worker CI job sets `TRANSFORMERS_OFFLINE=1` / `HF_HUB_OFFLINE=1`.
- Don't commit `.env`, `.venv-*`, or `web/dist/`.

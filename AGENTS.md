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
make happy    # install api + web, typecheck, build, api import smoke
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

## Where to add things

- New API route -> `api/app/routes/<name>.py`, register in `api/app/main.py`.
- New ingest source -> `worker/sources/<name>.py`, wired up in
  `worker/ingest.py`.
- New env var -> `.env.example` + the matching `Settings` class in
  `api/app/config.py` or `worker/config.py`.
- New npm/pip dep -> update the matching lockfile/requirements; CI enforces
  install from lockfiles.

## Out of scope / do not change without asking

- Don't replace psycopg 3 with psycopg2 or asyncpg.
- Don't consolidate api+worker into one service (torch would bloat the
  public image).
- Don't add CI jobs that download HuggingFace models at test time; the
  worker CI job sets `TRANSFORMERS_OFFLINE=1` / `HF_HUB_OFFLINE=1`.
- Don't commit `.env`, `.venv-*`, or `web/dist/`.

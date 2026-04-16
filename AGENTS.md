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

## Conventions to preserve

- **Postgres driver.** We use psycopg 3 (`psycopg[binary]`), not psycopg2.
  `Settings.resolved_database_url` rewrites any `postgresql://` URL to
  `postgresql+psycopg://` -- always go through that property, never read
  `settings.database_url` directly when creating an engine.
- **DB URL fallback.** `DATABASE_URL` wins, falls back to
  `DATABASE_PUBLIC_URL`. Railway injects both; external envs (Factory
  cloud, CI, local) use the public one.
- **FastAPI responses.** `default_response_class=ORJSONResponse` is
  intentional (orjson is a dep). Don't set it to `None`.
- **Railway `startCommand`.** Must be wrapped in `sh -c '...'` whenever
  it contains `${VAR}`; Railway exec's the command without a shell.
- **Minimal comments.** Match existing style; add comments only when
  behavior is non-obvious.

## Common pitfalls (seen in Railway logs)

- `ModuleNotFoundError: No module named 'psycopg2'` -- URL wasn't
  normalized. Use `resolved_database_url`.
- `Invalid value for '--port': '${PORT:-8000}'` -- missing `sh -c` wrapper
  in a `railway.json` start command.
- `'NoneType' object is not callable` from ASGI -- someone set
  `default_response_class=None` again.
- "No start command detected" on Railway -- Railway only auto-discovers
  `railway.json` at the service's Root Directory, not inside `infra/`.

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

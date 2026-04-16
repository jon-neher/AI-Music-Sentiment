# AI Music Sentiment

Sonifies AI-related news/research sentiment as an ambient soundscape. Three
services share one Postgres:

```
web (Vite/TS)  --HTTP-->  api (FastAPI)  <--reads/writes-->  Postgres
                                                  ^
                                                  |
                                          worker (APScheduler
                                          ingest -> score -> aggregate)
```

## Quickstart

Requirements: Python 3.11, Node 20 (pinned in `.python-version` / `.nvmrc` /
`.tool-versions`).

```bash
make install        # api + web (fast)
make happy          # install -> typecheck -> build -> api import smoke
make install-worker # adds the ML worker venv (torch+transformers, ~1.5GB)
```

For a full local stack with Postgres: `docker compose up` (see
`docker-compose.yml`). Copy `.env.example` to `.env` first.

## Layout

- `api/` -- FastAPI service. Entrypoint `app.main:app`. Dockerfile and
  `railway.json` colocated.
- `worker/` -- APScheduler loop; sources in `worker/sources/`.
- `web/` -- Vite + TypeScript frontend. `npm run dev` for local.
- `.github/workflows/ci.yml` -- runs the happy path on push/PR.

## Deploy

Each directory ships its own `Dockerfile` + `railway.json`. In Railway, set
each service's **Root Directory** to `api`, `worker`, or `web`; everything
else (builder, start command, healthcheck) is auto-read from the config
file. Attach the Railway Postgres plugin and reference its URL with
`DATABASE_URL=${{Postgres.DATABASE_URL}}`. See `.env.example` for the full
list of env vars.

## For AI agents

See [`AGENTS.md`](./AGENTS.md) for conventions, validators, and pitfalls.

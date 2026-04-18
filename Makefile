SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c

PY ?= $(shell command -v python3.11 2>/dev/null || command -v python3)
VENV_API := .venv-api
VENV_WORKER := .venv-worker
SMOKE_DB_URL ?= sqlite+pysqlite:///tmp/sentiment.db

.PHONY: help install install-api install-web install-worker \
        typecheck build test test-api test-web \
        smoke smoke-api smoke-worker happy \
        clean

help:
	@echo "Targets:"
	@echo "  install         api + web deps (fast)"
	@echo "  install-worker  heavy ML worker deps (torch/transformers, ~1.5 GB)"
	@echo "  typecheck       web tsc --noEmit"
	@echo "  build           web production build"
	@echo "  test            api pytest + web vitest"
	@echo "  smoke           api + (if installed) worker import smoke"
	@echo "  happy           install -> typecheck -> test -> build -> smoke"
	@echo "  clean           remove venvs and web build artifacts"

install: install-api install-web

install-api:
	$(PY) -m venv $(VENV_API)
	./$(VENV_API)/bin/pip install --upgrade pip
	./$(VENV_API)/bin/pip install -r api/requirements-dev.txt

install-web:
	cd web && npm ci

install-worker:
	$(PY) -m venv $(VENV_WORKER)
	./$(VENV_WORKER)/bin/pip install --upgrade pip
	./$(VENV_WORKER)/bin/pip install -r worker/requirements.txt

typecheck:
	cd web && npm run typecheck

build:
	cd web && npm run build

test: test-api test-web

test-api:
	cd api && DATABASE_URL="$${DATABASE_URL:-$(SMOKE_DB_URL)}" ../$(VENV_API)/bin/python -m pytest -q

test-web:
	cd web && npm test

smoke: smoke-api
	@if [ -x ./$(VENV_WORKER)/bin/python ]; then $(MAKE) smoke-worker; else echo "skip worker smoke (.venv-worker not installed)"; fi

smoke-api:
	cd api && DATABASE_URL="$${DATABASE_URL:-$(SMOKE_DB_URL)}" ../$(VENV_API)/bin/python -c "from app import main; print('api import OK')"

smoke-worker:
	DATABASE_URL="$${DATABASE_URL:-$(SMOKE_DB_URL)}" ./$(VENV_WORKER)/bin/python -c "import worker.schedule; print('worker import OK')"

happy: install typecheck test build smoke

clean:
	rm -rf $(VENV_API) $(VENV_WORKER) web/dist web/node_modules

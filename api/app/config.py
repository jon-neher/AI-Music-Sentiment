from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Railway's Postgres plugin injects BOTH of these:
    #   DATABASE_URL         -> private (e.g. postgres.railway.internal), used by
    #                           services deployed inside the Railway network.
    #   DATABASE_PUBLIC_URL  -> public TCP proxy, reachable from outside Railway
    #                           (e.g. Factory cloud machines, local dev).
    # We prefer DATABASE_URL when set and fall back to DATABASE_PUBLIC_URL, so the
    # same codebase works in Railway and in external agentic workspaces.
    database_url: str = ""
    database_public_url: str = ""
    cors_origins: str = "*"
    environment: str = "dev"

    @property
    def resolved_database_url(self) -> str:
        return _normalize_pg_url(self.database_url or self.database_public_url)


def _normalize_pg_url(url: str) -> str:
    """Ensure the URL uses the psycopg (v3) SQLAlchemy dialect.

    Railway's Postgres plugin injects DATABASE_URL as ``postgresql://…`` (or
    occasionally ``postgres://…``). SQLAlchemy's default driver for both of
    those schemes is psycopg2, which we do not install -- we ship psycopg 3
    via ``psycopg[binary]``. Rewriting the scheme to ``postgresql+psycopg``
    makes SQLAlchemy pick the installed driver.
    """
    if not url:
        return url
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://",
                   "sqlite", "mysql"):
        if url.startswith(prefix):
            return url
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


@lru_cache
def get_settings() -> Settings:
    return Settings()

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
        return self.database_url or self.database_public_url


@lru_cache
def get_settings() -> Settings:
    return Settings()

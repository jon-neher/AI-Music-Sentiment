from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Railway's Postgres plugin injects BOTH DATABASE_URL (private, used inside
    # the Railway network) and DATABASE_PUBLIC_URL (public TCP proxy, reachable
    # from Factory cloud machines / local dev). Prefer DATABASE_URL; fall back.
    database_url: str = ""
    database_public_url: str = ""

    @property
    def resolved_database_url(self) -> str:
        return _normalize_pg_url(self.database_url or self.database_public_url)

    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "ai-sentiment-sonification/0.1"
    # AI-focused subs: every post is on-topic, pulled unfiltered.
    reddit_subs_ai: str = "MachineLearning,LocalLLaMA,singularity,OpenAI,artificial,ChatGPT"
    # General high-traffic subs: pulled and keyword-filtered with `ai_keywords`
    # to surface how AI is discussed in the broader news/public cycle.
    reddit_subs_general: str = (
        "news,worldnews,technology,science,Futurology,UpliftingNews,Economics,business"
    )

    newsapi_key: str = ""

    # Bluesky (optional; enables Bluesky ingest). Use an app password, not your
    # account password: https://bsky.app/settings/app-passwords
    bluesky_identifier: str = ""
    bluesky_app_password: str = ""

    sentiment_model: str = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    emotion_model: str = "j-hartmann/emotion-english-distilroberta-base"

    ai_keywords: str = (
        "artificial intelligence,AI,machine learning,deep learning,neural network,"
        "LLM,large language model,GPT,ChatGPT,transformer,AGI,generative AI,"
        "foundation model,diffusion model"
    )

    backfill_start: str = "2015-01-01"

    @property
    def keywords(self) -> list[str]:
        return [k.strip().lower() for k in self.ai_keywords.split(",") if k.strip()]

    @property
    def ai_subs_list(self) -> list[str]:
        return [s.strip() for s in self.reddit_subs_ai.split(",") if s.strip()]

    @property
    def general_subs_list(self) -> list[str]:
        return [s.strip() for s in self.reddit_subs_general.split(",") if s.strip()]


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

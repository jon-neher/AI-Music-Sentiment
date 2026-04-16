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
        return self.database_url or self.database_public_url

    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "ai-sentiment-sonification/0.1"

    newsapi_key: str = ""

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


@lru_cache
def get_settings() -> Settings:
    return Settings()

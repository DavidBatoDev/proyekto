from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    app_name: str = 'Roadmap AI Agent'
    app_env: str = 'development'
    app_host: str = '0.0.0.0'
    app_port: int = 8010

    nest_api_base_url: str = 'http://localhost:3000/api'
    nest_timeout_seconds: float = 20.0

    openai_api_key: str | None = None
    openai_model: str = 'gpt-5-mini'

    session_ttl_seconds: int = 1800
    max_operations_per_request: int = 25


@lru_cache
def get_settings() -> Settings:
    return Settings()
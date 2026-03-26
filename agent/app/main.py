from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.sessions import router as sessions_router
from app.core.config import get_settings
from app.core.logging_utils import configure_logging

settings = get_settings()
configure_logging(settings)
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)


@app.get('/')
def root() -> dict[str, str]:
    return {'status': 'ok', 'env': settings.app_env}

@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok', 'env': settings.app_env}

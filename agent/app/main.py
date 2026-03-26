from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.sessions import router as sessions_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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

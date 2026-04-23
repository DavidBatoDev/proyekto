import os

import uvicorn

from app.core.config import get_settings


if __name__ == '__main__':
    settings = get_settings()
    port = int(os.environ.get('PORT') or settings.app_port)
    uvicorn.run(
        'app.main:app',
        host=settings.app_host,
        port=port,
        reload=settings.app_env == 'development',
    )

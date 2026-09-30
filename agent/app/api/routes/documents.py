"""Document AI endpoints: contract change summaries (and, below, intake).

Same trust model as briefs.py: never called from the browser. NestJS validates
the caller's session and authorization, computes everything that touches data,
and forwards here with the shared AGENT_INTERNAL_TOKEN. These routes touch no
data, they only spend OpenAI credits, which is exactly why they must not be an
unauthenticated proxy.
"""

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.api.routes.briefs import _authorize
from app.core.config import get_settings
from app.core.contracts.documents import (
    SummarizeChangesRequest,
    SummarizeChangesResponse,
)
from app.core.documents.change_summary import summarize_changes

logger = logging.getLogger(__name__)

router = APIRouter(tags=['documents'])


def _openai_client(request: Request, settings):
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail='openai key not configured')
    client = getattr(request.app.state, 'document_client', None)
    if client is None:
        try:
            from openai import OpenAI
        except Exception as exc:  # pragma: no cover - import guard
            logger.exception('openai sdk unavailable')
            raise HTTPException(status_code=503, detail='openai sdk unavailable') from exc
        client = OpenAI(api_key=settings.openai_api_key, timeout=90)
        request.app.state.document_client = client
    return client


def _document_model(settings) -> str:
    return settings.agent_document_model or settings.openai_model_v2


def _vision_model(settings) -> str:
    return settings.agent_vision_model or _document_model(settings)


@router.post('/contracts/summarize-changes', response_model=SummarizeChangesResponse)
async def contracts_summarize_changes(
    payload: SummarizeChangesRequest,
    request: Request,
    x_internal_token: str | None = Header(default=None, alias='X-Internal-Token'),
) -> SummarizeChangesResponse:
    settings = get_settings()
    _authorize(settings, x_internal_token)
    client = _openai_client(request, settings)
    try:
        return summarize_changes(
            payload,
            client=client,
            model=_document_model(settings),
            max_output_tokens=settings.agent_document_max_output_tokens,
        )
    except ValueError as exc:
        logger.warning('change summary unusable: %s', exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

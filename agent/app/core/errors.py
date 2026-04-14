from __future__ import annotations

from enum import Enum
from typing import Any

from fastapi import HTTPException


class ErrorCode(str, Enum):
    # Tool dispatch
    UNKNOWN_TOOL = 'UNKNOWN_TOOL'
    MISSING_ROADMAP_ID = 'MISSING_ROADMAP_ID'
    ROADMAP_SCOPE_MISMATCH = 'ROADMAP_SCOPE_MISMATCH'
    CONTEXT_TOOL_FAILED = 'CONTEXT_TOOL_FAILED'

    # Tool-argument validation
    MISSING_QUERY = 'MISSING_QUERY'
    MISSING_LABEL = 'MISSING_LABEL'
    MISSING_RESOLUTION_ID = 'MISSING_RESOLUTION_ID'
    MISSING_EPIC_ID = 'MISSING_EPIC_ID'
    MISSING_FEATURE_ID = 'MISSING_FEATURE_ID'
    MISSING_NODE_ID = 'MISSING_NODE_ID'
    MISSING_PARENT_ID = 'MISSING_PARENT_ID'
    INVALID_ARGUMENT = 'INVALID_ARGUMENT'
    INVALID_UUID = 'INVALID_UUID'
    TYPE_MISMATCH = 'TYPE_MISMATCH'

    # Session / route layer
    EMPTY_OPERATIONS = 'EMPTY_OPERATIONS'
    MISSING_CHANGE_ID = 'MISSING_CHANGE_ID'
    SESSION_STORE_UNAVAILABLE = 'SESSION_STORE_UNAVAILABLE'
    TRACE_EVENTS_NOT_FOUND = 'TRACE_EVENTS_NOT_FOUND'
    ASYNC_BRIDGE_UNAVAILABLE = 'ASYNC_BRIDGE_UNAVAILABLE'
    LEGACY_SESSION_UNSUPPORTED = 'LEGACY_SESSION_UNSUPPORTED'


class AgentError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        http_status: int = 400,
        retriable: bool = False,
    ) -> None:
        self.code = code.value if isinstance(code, Enum) else str(code)
        self.message = message
        self.details = details or {}
        self.http_status = http_status
        self.retriable = retriable
        super().__init__(f'{self.code}: {message}')

    def to_tool_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {'code': self.code, 'message': self.message}
        if self.details:
            payload['details'] = self.details
        return {'error': payload}


def error_dict(
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Blessed constructor for the tool-result error dict shape.

    Existing handlers build these dicts inline; new code should use this helper
    so the shape stays centralized. Shape:
        {'error': {'code': str, 'message': str, 'details'?: dict}}
    """
    code_str = code.value if isinstance(code, Enum) else str(code)
    payload: dict[str, Any] = {'code': code_str, 'message': message}
    if details:
        payload['details'] = details
    return {'error': payload}


def to_http_exception(error: AgentError) -> HTTPException:
    detail: dict[str, Any] = {'code': error.code, 'message': error.message}
    if error.details:
        detail['details'] = error.details
    if error.retriable:
        detail['retriable'] = True
    return HTTPException(status_code=error.http_status, detail=detail)

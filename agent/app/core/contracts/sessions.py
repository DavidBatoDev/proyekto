from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.core.contracts.operations import RoadmapOperation


class Message(BaseModel):
    role: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


IntentType = Literal['smalltalk', 'question', 'roadmap_edit', 'unclear']
ResponseMode = Literal['chat', 'edit_plan']


class AgentSession(BaseModel):
    model_config = ConfigDict(extra='forbid')

    session_id: str = Field(default_factory=lambda: str(uuid4()))
    roadmap_id: str
    base_revision: int | None = None
    operations: list[RoadmapOperation] = Field(default_factory=list)
    staged_operations_version: int = 0
    latest_preview_id: str | None = None
    last_intent_type: IntentType | None = None
    messages: list[Message] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CreateSessionRequest(BaseModel):
    roadmap_id: str
    base_revision: int | None = None
    metadata: dict[str, Any] | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    roadmap_id: str
    base_revision: int | None = None
    created_at: datetime


class MessageRequest(BaseModel):
    message: str
    replace_operations: bool = False


class MessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    operations: list[RoadmapOperation]
    preview_available: bool
    preview_recommended: bool
    staged_operations_version: int
    staged_operations_count: int


class PreviewRequest(BaseModel):
    operations: list[RoadmapOperation] | None = None
    base_revision: int | None = None


class CommitRequest(BaseModel):
    preview_id: str | None = None
    base_revision: int | None = None


class RollbackRequest(BaseModel):
    target_revision: int

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OperationType(str, Enum):
    ADD_EPIC = 'add_epic'
    ADD_FEATURE = 'add_feature'
    ADD_TASK = 'add_task'
    UPDATE_NODE = 'update_node'
    MOVE_NODE = 'move_node'
    DELETE_NODE = 'delete_node'
    MARK_STATUS = 'mark_status'
    SHIFT_DATES = 'shift_dates'


class NodeType(str, Enum):
    ROADMAP = 'roadmap'
    EPIC = 'epic'
    FEATURE = 'feature'
    TASK = 'task'


class RoadmapOperation(BaseModel):
    model_config = ConfigDict(extra='forbid')

    op: OperationType
    node_type: NodeType | None = None
    node_id: str | None = None
    parent_id: str | None = None
    new_parent_id: str | None = None
    position: int | None = Field(default=None, ge=0)
    patch: dict[str, Any] | None = None
    status: str | None = None
    delta_days: int | None = None
    scope: dict[str, Any] | None = None
    data: dict[str, Any] | None = None


class ValidationIssue(BaseModel):
    code: str
    severity: Literal['error', 'warning']
    path: str
    message: str
    node_ref: dict[str, str] | None = None


class SemanticDiffChange(BaseModel):
    type: str
    node: dict[str, str]
    from_: dict[str, Any] | None = Field(default=None, alias='from')
    to: dict[str, Any] | None = None


class SemanticDiff(BaseModel):
    summary: dict[str, int]
    changes: list[SemanticDiffChange]
from enum import Enum
from typing import Any, Callable, Literal

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

    def semantic_contract_issues(
        self,
        *,
        is_uuid: Callable[[str | None], bool],
    ) -> list[str]:
        op_name = self.op.value
        issues: list[str] = []

        if op_name == 'add_epic':
            if self._read_title() is None:
                issues.append('add_epic.data.title_missing')

        if op_name in {'add_feature', 'add_task'}:
            if not is_uuid(self.parent_id):
                issues.append(f'{op_name}.parent_id_invalid_uuid')
            if self._read_title() is None:
                issues.append(f'{op_name}.data.title_missing')

        if op_name in {'update_node', 'delete_node', 'move_node', 'mark_status', 'shift_dates'}:
            if not is_uuid(self.node_id):
                issues.append(f'{op_name}.node_id_invalid_uuid')

        if op_name == 'move_node':
            if self.new_parent_id is not None and not is_uuid(self.new_parent_id):
                issues.append('move_node.new_parent_id_invalid_uuid')

        if op_name == 'mark_status':
            normalized_status = self.status.strip() if isinstance(self.status, str) else ''
            if not normalized_status:
                issues.append('mark_status.status_missing')

        if op_name == 'shift_dates':
            if self.delta_days is None:
                issues.append('shift_dates.delta_days_missing')
            elif self.delta_days < -3650 or self.delta_days > 3650:
                issues.append('shift_dates.delta_days_out_of_range')

        if self.parent_id is not None and not is_uuid(self.parent_id):
            issues.append(f'{op_name}.parent_id_invalid_uuid')

        return issues

    def _read_title(self) -> str | None:
        if not isinstance(self.data, dict):
            return None
        title = self.data.get('title')
        if isinstance(title, str):
            normalized = title.strip()
            if normalized:
                return normalized
        return None


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
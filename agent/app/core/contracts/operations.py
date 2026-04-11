from enum import Enum
import re
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
    node_ref: str | None = None
    parent_id: str | None = None
    parent_ref: str | None = None
    new_parent_id: str | None = None
    new_parent_ref: str | None = None
    temp_id: str | None = None
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

        def _is_valid_ref(value: str | None) -> bool:
            if not isinstance(value, str):
                return False
            normalized = value.strip()
            if not normalized:
                return False
            return bool(
                re.fullmatch(
                    r'(?i)(?:tmp|t|temp|epic|feature|task)[_-][a-z0-9][a-z0-9_-]{0,63}',
                    normalized,
                )
            )

        def _has_identity_conflict(id_value: str | None, ref_value: str | None) -> bool:
            return bool(
                isinstance(id_value, str)
                and id_value.strip()
                and isinstance(ref_value, str)
                and ref_value.strip()
            )

        def _is_valid_target(id_value: str | None, ref_value: str | None) -> bool:
            return bool(is_uuid(id_value) or _is_valid_ref(ref_value))

        if op_name == 'add_epic':
            if self._read_title() is None:
                issues.append('add_epic.data.title_missing')
            if _has_identity_conflict(self._read_data_id(), self.temp_id):
                issues.append('add_epic.identity_conflict')
            elif self.temp_id is not None and not _is_valid_ref(self.temp_id):
                issues.append('add_epic.temp_id_invalid_ref')
            elif self._read_data_id() is not None and not is_uuid(self._read_data_id()):
                issues.append('add_epic.data.id_invalid_uuid')

        if op_name in {'add_feature', 'add_task'}:
            if _has_identity_conflict(self._read_data_id(), self.temp_id):
                issues.append(f'{op_name}.identity_conflict')
            elif self.temp_id is not None and not _is_valid_ref(self.temp_id):
                issues.append(f'{op_name}.temp_id_invalid_ref')
            elif self._read_data_id() is not None and not is_uuid(self._read_data_id()):
                issues.append(f'{op_name}.data.id_invalid_uuid')

            if _has_identity_conflict(self.parent_id, self.parent_ref):
                issues.append(f'{op_name}.parent_target_conflict')
            elif self.parent_id is None and self.parent_ref is None:
                issues.append(f'{op_name}.parent_target_missing')
            elif not _is_valid_target(self.parent_id, self.parent_ref):
                if self.parent_id is not None:
                    issues.append(f'{op_name}.parent_id_invalid_uuid')
                else:
                    issues.append(f'{op_name}.parent_ref_invalid_ref')
            if self._read_title() is None:
                issues.append(f'{op_name}.data.title_missing')

        if op_name in {'update_node', 'delete_node', 'move_node', 'mark_status', 'shift_dates'}:
            if _has_identity_conflict(self.node_id, self.node_ref):
                issues.append(f'{op_name}.target_conflict')
            elif self.node_id is None and self.node_ref is None:
                issues.append(f'{op_name}.target_missing')
            elif not _is_valid_target(self.node_id, self.node_ref):
                if self.node_id is not None:
                    issues.append(f'{op_name}.node_id_invalid_uuid')
                else:
                    issues.append(f'{op_name}.node_ref_invalid_ref')

        if op_name == 'update_node' and not self._has_update_mutation_payload():
            issues.append('update_node.mutation_missing')

        if op_name == 'move_node':
            if _has_identity_conflict(self.new_parent_id, self.new_parent_ref):
                issues.append('move_node.new_parent_target_conflict')
            elif self.new_parent_id is not None or self.new_parent_ref is not None:
                if not _is_valid_target(self.new_parent_id, self.new_parent_ref):
                    if self.new_parent_id is not None:
                        issues.append('move_node.new_parent_id_invalid_uuid')
                    else:
                        issues.append('move_node.new_parent_ref_invalid_ref')

        if op_name == 'mark_status':
            normalized_status = self.status.strip() if isinstance(self.status, str) else ''
            if not normalized_status:
                issues.append('mark_status.status_missing')

        if op_name == 'shift_dates':
            if self.delta_days is None:
                issues.append('shift_dates.delta_days_missing')
            elif self.delta_days < -3650 or self.delta_days > 3650:
                issues.append('shift_dates.delta_days_out_of_range')

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

    def _read_data_id(self) -> str | None:
        if not isinstance(self.data, dict):
            return None
        data_id = self.data.get('id')
        if isinstance(data_id, str):
            normalized = data_id.strip()
            if normalized:
                return normalized
        return None

    def _has_update_mutation_payload(self) -> bool:
        if isinstance(self.patch, dict) and bool(self.patch):
            return True
        if isinstance(self.data, dict) and bool(self.data):
            return True
        if isinstance(self.status, str) and bool(self.status.strip()):
            return True
        if isinstance(self.scope, dict) and bool(self.scope):
            return True
        if self.delta_days is not None:
            return True
        return False


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
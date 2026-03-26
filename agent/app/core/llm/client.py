import json
import re
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.tools.registry import get_operation_tools

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore


SYSTEM_PROMPT = (
    'You are a roadmap editing planner. Produce safe operation lists only. '
    'Never rewrite full JSON. Never mutate unrelated fields. '
    'Prefer the minimum set of operations needed to satisfy user intent.'
)


@dataclass
class PlanningResult:
    assistant_message: str
    operations: list[RoadmapOperation]
    parse_mode: str


class LLMPlanner:
    def __init__(self) -> None:
        self._settings = get_settings()

    def plan(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
    ) -> PlanningResult:
        if self._settings.openai_api_key and OpenAI is not None:
            llm_result = self._plan_with_openai(user_message, existing_operations)
            if llm_result is not None:
                return llm_result

        return self._plan_with_rules(user_message)

    def _plan_with_openai(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
    ) -> PlanningResult | None:
        try:
            client = OpenAI(api_key=self._settings.openai_api_key)
            response = client.responses.create(
                model=self._settings.openai_model,
                input=[
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {
                        'role': 'user',
                        'content': (
                            'Current operations:\n'
                            + json.dumps([op.model_dump() for op in existing_operations])
                            + '\n\nUser request:\n'
                            + user_message
                            + '\n\nReturn a single tool call to plan_roadmap_operations.'
                        ),
                    },
                ],
                tools=get_operation_tools(),
                tool_choice='required',
            )
        except Exception:
            return None

        tool_call = None
        for item in getattr(response, 'output', []) or []:
            if getattr(item, 'type', '') == 'function_call':
                tool_call = item
                break

        if tool_call is None:
            return None

        try:
            parsed = json.loads(tool_call.arguments)
            operations = [RoadmapOperation.model_validate(op) for op in parsed['operations']]
            assistant_message = str(parsed.get('assistant_message', 'Prepared roadmap operations.'))
        except Exception:
            return None

        return PlanningResult(
            assistant_message=assistant_message,
            operations=operations,
            parse_mode='openai_function_calling',
        )

    def _plan_with_rules(self, user_message: str) -> PlanningResult:
        text = user_message.strip()
        operations: list[RoadmapOperation] = []

        move_match = re.search(
            r'move\s+([0-9a-fA-F-]{36})\s+under\s+([0-9a-fA-F-]{36})(?:\s+at\s+(\d+))?',
            text,
            re.IGNORECASE,
        )
        if move_match:
            operations.append(
                RoadmapOperation(
                    op='move_node',
                    node_id=move_match.group(1),
                    new_parent_id=move_match.group(2),
                    position=int(move_match.group(3)) if move_match.group(3) else None,
                )
            )

        mark_done_match = re.search(
            r'mark\s+([0-9a-fA-F-]{36})\s+(done|completed|in_progress|blocked|todo)',
            text,
            re.IGNORECASE,
        )
        if mark_done_match:
            status_value = mark_done_match.group(2).lower()
            if status_value == 'completed':
                status_value = 'done'
            operations.append(
                RoadmapOperation(
                    op='mark_status',
                    node_id=mark_done_match.group(1),
                    status=status_value,
                )
            )

        delete_match = re.search(r'delete\s+([0-9a-fA-F-]{36})', text, re.IGNORECASE)
        if delete_match:
            operations.append(
                RoadmapOperation(
                    op='delete_node',
                    node_id=delete_match.group(1),
                )
            )

        shift_match = re.search(
            r'shift\s+([0-9a-fA-F-]{36})\s+by\s+(-?\d+)\s+days?',
            text,
            re.IGNORECASE,
        )
        if shift_match:
            operations.append(
                RoadmapOperation(
                    op='shift_dates',
                    node_id=shift_match.group(1),
                    delta_days=int(shift_match.group(2)),
                )
            )

        if operations:
            return PlanningResult(
                assistant_message='Parsed your request and prepared structured roadmap operations.',
                operations=operations,
                parse_mode='rule_based',
            )

        return PlanningResult(
            assistant_message=(
                'I could not safely infer concrete operations from that message. '
                'Please include explicit node IDs and action, for example: '
                '"move <feature_uuid> under <epic_uuid> at 0".'
            ),
            operations=[],
            parse_mode='rule_based',
        )
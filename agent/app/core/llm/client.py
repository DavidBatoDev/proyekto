from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, TypedDict

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ProviderUsed, ResponseMode
from app.core.llm.providers import ProviderAdapterError, ProviderOrchestrator
from app.core.prompts import PromptRepository

try:
    from langchain_core.messages import AIMessage, HumanMessage
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover
    AIMessage = None  # type: ignore[assignment]
    HumanMessage = None  # type: ignore[assignment]
    StateGraph = None  # type: ignore[assignment]
    END = None  # type: ignore[assignment]


class PlannerState(TypedDict, total=False):
    user_message: str
    existing_operations: list[RoadmapOperation]
    session_context: dict[str, Any]
    intent_type: IntentType
    response_mode: ResponseMode
    system_prompt: str
    assistant_message: str
    planned_operations: list[RoadmapOperation]
    parse_mode: str
    preview_recommended: bool
    provider_used: ProviderUsed
    fallback_used: bool
    provider_error_code: str | None


@dataclass
class PlanningResult:
    assistant_message: str
    operations: list[RoadmapOperation]
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    preview_recommended: bool
    provider_used: ProviderUsed
    fallback_used: bool
    provider_error_code: str | None


class LLMPlanner:
    def __init__(self) -> None:
        self._logger = logging.getLogger(__name__)
        self._settings = get_settings()
        self._prompt_repository = PromptRepository()
        self._provider_orchestrator = ProviderOrchestrator(self._settings)
        self._langgraph_disabled_reason = self._get_langgraph_disabled_reason()
        self._langgraph = self._build_graph() if self._langgraph_disabled_reason is None else None

        if self._langgraph_disabled_reason is not None:
            self._logger.warning(
                'LangGraph disabled; using rule-based planner. Reason: %s',
                self._langgraph_disabled_reason,
            )

    def plan(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any] | None = None,
    ) -> PlanningResult:
        if self._langgraph is not None:
            graph_result = self._plan_with_langgraph(
                user_message=user_message,
                existing_operations=existing_operations,
                session_context=session_context or {},
            )
            if graph_result is not None:
                return graph_result
            self._logger.warning('LangGraph returned no result; falling back to rule-based planner.')

        return self._plan_with_rules(
            user_message=user_message,
            existing_operations=existing_operations,
        )

    def _get_langgraph_disabled_reason(self) -> str | None:
        if StateGraph is None or END is None:
            return 'langgraph import failed'
        return None

    def _build_graph(self) -> Any:
        graph = StateGraph(PlannerState)
        graph.add_node('classify_intent', self._classify_intent)
        graph.add_node('compose_dynamic_system_prompt', self._compose_dynamic_system_prompt)
        graph.add_node('generate_chat_reply', self._generate_chat_reply)
        graph.add_node('plan_operations', self._plan_operations)
        graph.add_node('persist_session_state', self._persist_session_state)

        graph.set_entry_point('classify_intent')
        graph.add_edge('classify_intent', 'compose_dynamic_system_prompt')
        graph.add_conditional_edges(
            'compose_dynamic_system_prompt',
            self._route_from_intent,
            {
                'generate_chat_reply': 'generate_chat_reply',
                'plan_operations': 'plan_operations',
            },
        )
        graph.add_edge('generate_chat_reply', 'persist_session_state')
        graph.add_edge('plan_operations', 'persist_session_state')
        graph.add_edge('persist_session_state', END)
        return graph.compile()

    def _plan_with_langgraph(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
    ) -> PlanningResult | None:
        try:
            state: PlannerState = self._langgraph.invoke(  # type: ignore[call-arg]
                {
                    'user_message': user_message,
                    'existing_operations': existing_operations,
                    'session_context': session_context,
                }
            )
        except Exception as exc:  # pragma: no cover
            self._logger.exception('LangGraph invocation failed: %s', exc)
            return None

        return PlanningResult(
            assistant_message=state.get('assistant_message', 'I can help with that.'),
            operations=state.get('planned_operations', []),
            parse_mode=state.get('parse_mode', 'rule_based_chat'),
            intent_type=state.get('intent_type', 'unclear'),
            response_mode=state.get('response_mode', 'chat'),
            preview_recommended=bool(state.get('preview_recommended', False)),
            provider_used=state.get('provider_used', 'rule_based'),
            fallback_used=bool(state.get('fallback_used', False)),
            provider_error_code=state.get('provider_error_code'),
        )

    def _classify_intent(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        session_context = state.get('session_context', {})
        heuristic_intent = self._heuristic_intent(user_message)

        classifier_prompt = self._prompt_repository.intent_classifier_prompt()
        classifier_input = self._build_classifier_input(user_message, session_context)

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.classify_intent(
                    classifier_prompt=classifier_prompt,
                    classifier_input=classifier_input,
                )
            )
            return {
                'intent_type': result.value,
                'parse_mode': f'{result.provider_used}_intent_classifier',
                'provider_used': result.provider_used,  # may be overwritten later
                'fallback_used': result.fallback_used,
                'provider_error_code': result.provider_error_code,
            }
        except ProviderAdapterError as exc:
            self._logger.warning(
                'Intent classifier failed for providers, using heuristic fallback. code=%s message=%s',
                exc.code,
                exc.message,
            )
            return {
                'intent_type': heuristic_intent,
                'parse_mode': 'rule_based_intent',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': exc.code,
            }

    def _compose_dynamic_system_prompt(self, state: PlannerState) -> PlannerState:
        intent_type = state.get('intent_type', 'unclear')
        mode = 'edit' if intent_type == 'roadmap_edit' else 'chat'
        session_context = state.get('session_context', {})
        prompt_context = {
            'roadmap_id': session_context.get('roadmap_id'),
            'base_revision': session_context.get('base_revision'),
            'staged_operations_count': len(state.get('existing_operations', [])),
            'recent_messages': session_context.get('recent_messages', []),
            'intent_type': intent_type,
        }
        system_prompt = self._prompt_repository.build_system_prompt(mode=mode, context=prompt_context)
        response_mode: ResponseMode = 'edit_plan' if intent_type == 'roadmap_edit' else 'chat'
        return {'system_prompt': system_prompt, 'response_mode': response_mode}

    def _route_from_intent(self, state: PlannerState) -> str:
        return 'plan_operations' if state.get('intent_type') == 'roadmap_edit' else 'generate_chat_reply'

    def _generate_chat_reply(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        system_prompt = state.get('system_prompt', '')
        history_messages = self._build_history_messages(state.get('session_context', {}))
        fallback_response = self._rule_based_chat_response(user_message, state.get('intent_type', 'unclear'))

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.generate_chat_reply(
                    system_prompt=system_prompt,
                    user_message=user_message,
                    history_messages=history_messages,
                )
            )
            return {
                'assistant_message': result.value,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_chat',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': result.provider_error_code,
            }
        except ProviderAdapterError as exc:
            self._logger.warning(
                'Provider chat reply failed, using rule-based chat fallback. code=%s message=%s',
                exc.code,
                exc.message,
            )
            return {
                'assistant_message': fallback_response,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'rule_based_chat',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': exc.code,
            }

    def _plan_operations(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        existing_operations = state.get('existing_operations', [])
        system_prompt = state.get('system_prompt', '')
        history_messages = self._build_history_messages(state.get('session_context', {}))
        fallback = self._rule_based_operation_plan(user_message)

        planner_prompt = (
            'Create roadmap edit operations using tool calling.\n'
            'Current staged operations:\n'
            f'{json.dumps([op.model_dump(exclude_none=True) for op in existing_operations])}\n\n'
            'User request:\n'
            f'{user_message}\n\n'
            'Use the plan_roadmap_operations tool once with assistant_message and operations.'
        )

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.plan_operations_with_tools(
                    system_prompt=system_prompt,
                    planner_prompt=planner_prompt,
                    history_messages=history_messages,
                )
            )
            assistant_message, operations = result.value
            return {
                'assistant_message': assistant_message,
                'planned_operations': operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(operations),
                'parse_mode': f'{result.provider_used}_tool_calling',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': result.provider_error_code,
            }
        except ProviderAdapterError as exc:
            self._logger.warning(
                'Provider operation planning failed, using rule-based edit fallback. code=%s message=%s',
                exc.code,
                exc.message,
            )
            return {
                'assistant_message': fallback.assistant_message,
                'planned_operations': fallback.operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(fallback.operations),
                'parse_mode': fallback.parse_mode,
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': exc.code,
            }

    def _persist_session_state(self, _state: PlannerState) -> PlannerState:
        return {}

    def _build_classifier_input(self, user_message: str, session_context: dict[str, Any]) -> str:
        payload = {
            'user_message': user_message,
            'roadmap_id': session_context.get('roadmap_id'),
            'base_revision': session_context.get('base_revision'),
            'recent_messages': session_context.get('recent_messages', []),
        }
        return json.dumps(payload, ensure_ascii=True, indent=2)

    def _build_history_messages(self, session_context: dict[str, Any]) -> list[Any]:
        if AIMessage is None or HumanMessage is None:
            return []

        history = session_context.get('recent_messages', [])
        messages: list[Any] = []
        for item in history[-self._settings.max_chat_history_messages :]:
            role = str(item.get('role', '')).strip().lower()
            content = str(item.get('content', '')).strip()
            if not content:
                continue
            if role == 'assistant':
                messages.append(AIMessage(content=content))
            elif role == 'user':
                messages.append(HumanMessage(content=content))
        return messages

    def _heuristic_intent(self, user_message: str) -> IntentType:
        text = user_message.strip().lower()
        if not text:
            return 'unclear'
        if text in {'hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening'}:
            return 'smalltalk'
        if re.search(r'\b(add|create|move|delete|remove|update|mark|shift|link|unlink)\b', text):
            return 'roadmap_edit'
        if text.endswith('?') or re.search(r'^(what|why|how|when|where|can you|could you|do we)\b', text):
            return 'question'
        return 'unclear'

    def _rule_based_chat_response(self, user_message: str, intent_type: IntentType) -> str:
        lowered = user_message.strip().lower()
        if intent_type == 'smalltalk':
            return 'Hi. I can chat normally and help you prepare roadmap edits when you are ready.'
        if intent_type == 'question':
            return (
                'I can help explain roadmap structure, suggest planning steps, and prepare safe edit operations '
                'that you can preview manually.'
            )
        if lowered:
            return (
                'I can help with normal chat or roadmap edits. If you want edits, describe the action and the target '
                'node IDs, then we can generate a preview.'
            )
        return 'Tell me what you want to do, and I will help.'

    def _rule_based_operation_plan(self, user_message: str) -> PlanningResult:
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
                assistant_message='I prepared roadmap edit operations. Click Preview to validate them before commit.',
                operations=operations,
                parse_mode='rule_based_edit',
                intent_type='roadmap_edit',
                response_mode='edit_plan',
                preview_recommended=True,
                provider_used='rule_based',
                fallback_used=False,
                provider_error_code=None,
            )

        return PlanningResult(
            assistant_message=(
                'I understand you want to edit the roadmap, but I need clearer targets. '
                'Please include specific node IDs and action, for example: '
                '"move <feature_uuid> under <epic_uuid> at 0".'
            ),
            operations=[],
            parse_mode='rule_based_edit',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='missing_tool_call',
        )

    def _plan_with_rules(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
    ) -> PlanningResult:
        intent_type = self._heuristic_intent(user_message)
        if intent_type == 'roadmap_edit':
            return self._rule_based_operation_plan(user_message)

        return PlanningResult(
            assistant_message=self._rule_based_chat_response(user_message, intent_type),
            operations=[],
            parse_mode='rule_based_chat',
            intent_type=intent_type,
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='no_provider_available',
        )

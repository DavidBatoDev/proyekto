from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, TypedDict

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ResponseMode
from app.core.prompts import PromptRepository
from app.core.tools.registry import get_operation_tools

try:
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from langchain_openai import ChatOpenAI
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover
    AIMessage = None  # type: ignore[assignment]
    HumanMessage = None  # type: ignore[assignment]
    SystemMessage = None  # type: ignore[assignment]
    ChatOpenAI = None  # type: ignore[assignment]
    StateGraph = None  # type: ignore[assignment]
    END = None  # type: ignore[assignment]


class IntentClassification(BaseModel):
    intent_type: IntentType
    rationale: str


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


@dataclass
class PlanningResult:
    assistant_message: str
    operations: list[RoadmapOperation]
    parse_mode: str
    intent_type: IntentType
    response_mode: ResponseMode
    preview_recommended: bool


class LLMPlanner:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._prompt_repository = PromptRepository()
        self._langchain_graph = self._build_graph() if self._can_use_langchain() else None

    def plan(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any] | None = None,
    ) -> PlanningResult:
        if self._langchain_graph is not None:
            langchain_result = self._plan_with_langchain(
                user_message=user_message,
                existing_operations=existing_operations,
                session_context=session_context or {},
            )
            if langchain_result is not None:
                return langchain_result

        return self._plan_with_rules(
            user_message=user_message,
            existing_operations=existing_operations,
            session_context=session_context or {},
        )

    def _can_use_langchain(self) -> bool:
        return bool(
            self._settings.openai_api_key
            and ChatOpenAI is not None
            and StateGraph is not None
            and SystemMessage is not None
            and HumanMessage is not None
            and AIMessage is not None
        )

    def _create_chat_model(self) -> Any:
        return ChatOpenAI(
            api_key=self._settings.openai_api_key,
            model=self._settings.openai_model,
            temperature=self._settings.openai_temperature,
            timeout=30,
        )

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

    def _plan_with_langchain(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
    ) -> PlanningResult | None:
        try:
            graph_result: PlannerState = self._langchain_graph.invoke(  # type: ignore[call-arg]
                {
                    'user_message': user_message,
                    'existing_operations': existing_operations,
                    'session_context': session_context,
                }
            )
        except Exception:
            return None

        operations = graph_result.get('planned_operations', [])
        return PlanningResult(
            assistant_message=graph_result.get('assistant_message', 'I can help with that.'),
            operations=operations,
            parse_mode=graph_result.get('parse_mode', 'langchain_fallback'),
            intent_type=graph_result.get('intent_type', 'unclear'),
            response_mode=graph_result.get('response_mode', 'chat'),
            preview_recommended=bool(graph_result.get('preview_recommended', False)),
        )

    def _classify_intent(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        session_context = state.get('session_context', {})
        fallback_intent = self._heuristic_intent(user_message)

        if not self._can_use_langchain():
            return {'intent_type': fallback_intent, 'parse_mode': 'rule_based_intent'}

        classifier_model = self._create_chat_model().with_structured_output(IntentClassification)
        classifier_prompt = self._prompt_repository.intent_classifier_prompt()
        classifier_input = self._build_classifier_input(user_message, session_context)

        try:
            classification: IntentClassification = classifier_model.invoke(
                [
                    SystemMessage(content=classifier_prompt),
                    HumanMessage(content=classifier_input),
                ]
            )
            return {
                'intent_type': classification.intent_type,
                'parse_mode': 'langchain_intent_classifier',
            }
        except Exception:
            return {'intent_type': fallback_intent, 'parse_mode': 'rule_based_intent'}

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
        session_context = state.get('session_context', {})
        history_messages = self._build_history_messages(session_context)

        if not self._can_use_langchain():
            return self._rule_based_chat_response(user_message, state.get('intent_type', 'unclear'))

        try:
            chat_model = self._create_chat_model()
            ai_message = chat_model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    *history_messages,
                    HumanMessage(content=user_message),
                ]
            )
            content = self._extract_text_content(ai_message.content)
            if not content:
                content = 'I can help with roadmap planning or general roadmap questions.'
            return {
                'assistant_message': content,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'langchain_chat',
            }
        except Exception:
            return self._rule_based_chat_response(user_message, state.get('intent_type', 'unclear'))

    def _plan_operations(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        existing_operations = state.get('existing_operations', [])
        system_prompt = state.get('system_prompt', '')
        session_context = state.get('session_context', {})

        if not self._can_use_langchain():
            fallback = self._rule_based_operation_plan(user_message)
            return {
                'assistant_message': fallback.assistant_message,
                'planned_operations': fallback.operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(fallback.operations),
                'parse_mode': 'rule_based_edit',
            }

        planner_prompt = (
            'Create roadmap edit operations using tool calling.\n'
            'Current staged operations:\n'
            f'{json.dumps([op.model_dump(exclude_none=True) for op in existing_operations])}\n\n'
            'User request:\n'
            f'{user_message}\n\n'
            'Use the plan_roadmap_operations tool once with assistant_message and operations.'
        )

        try:
            tool_model = self._create_chat_model().bind_tools(
                get_operation_tools(),
                tool_choice={'type': 'function', 'function': {'name': 'plan_roadmap_operations'}},
            )
            ai_message = tool_model.invoke(
                [
                    SystemMessage(content=system_prompt),
                    *self._build_history_messages(session_context),
                    HumanMessage(content=planner_prompt),
                ]
            )
            tool_calls = getattr(ai_message, 'tool_calls', []) or []
            tool_call = next((call for call in tool_calls if call.get('name') == 'plan_roadmap_operations'), None)

            if tool_call is None:
                raise ValueError('Expected plan_roadmap_operations tool call.')

            args = tool_call.get('args', {})
            if isinstance(args, str):
                args = json.loads(args)

            raw_operations = args.get('operations', [])
            operations = [RoadmapOperation.model_validate(item) for item in raw_operations]
            assistant_message = str(args.get('assistant_message', 'Prepared roadmap operations.'))

            return {
                'assistant_message': assistant_message,
                'planned_operations': operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(operations),
                'parse_mode': 'langchain_tool_calling',
            }
        except Exception:
            fallback = self._rule_based_operation_plan(user_message)
            return {
                'assistant_message': fallback.assistant_message,
                'planned_operations': fallback.operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(fallback.operations),
                'parse_mode': 'rule_based_edit',
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

    def _extract_text_content(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            chunks: list[str] = []
            for item in content:
                if isinstance(item, str):
                    chunks.append(item)
                elif isinstance(item, dict):
                    text = item.get('text')
                    if isinstance(text, str):
                        chunks.append(text)
            return '\n'.join(part for part in chunks if part).strip()
        return ''

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

    def _rule_based_chat_response(self, user_message: str, intent_type: IntentType) -> PlannerState:
        lowered = user_message.strip().lower()
        if intent_type == 'smalltalk':
            return {
                'assistant_message': 'Hi. I can chat normally and help you prepare roadmap edits when you are ready.',
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'rule_based_chat',
            }
        if intent_type == 'question':
            return {
                'assistant_message': (
                    'I can help explain roadmap structure, suggest planning steps, and prepare safe edit operations '
                    'that you can preview manually.'
                ),
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'rule_based_chat',
            }
        if lowered:
            return {
                'assistant_message': (
                    'I can help with normal chat or roadmap edits. If you want edits, describe the action and the target '
                    'node IDs, then we can generate a preview.'
                ),
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'rule_based_chat',
            }
        return {
            'assistant_message': 'Tell me what you want to do, and I will help.',
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'rule_based_chat',
        }

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
        )

    def _plan_with_rules(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
    ) -> PlanningResult:
        intent_type = self._heuristic_intent(user_message)
        if intent_type == 'roadmap_edit':
            return self._rule_based_operation_plan(user_message)

        chat_state = self._rule_based_chat_response(user_message, intent_type)
        return PlanningResult(
            assistant_message=chat_state['assistant_message'],
            operations=[],
            parse_mode=chat_state['parse_mode'],
            intent_type=intent_type,
            response_mode='chat',
            preview_recommended=False,
        )

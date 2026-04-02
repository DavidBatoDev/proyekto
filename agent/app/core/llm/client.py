from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ProviderUsed, ResponseMode
from app.core.logging_utils import log_event
from app.core.llm.context_answer_service import ContextAnswerService
from app.core.llm.context_tools_executor import ContextToolsExecutor
from app.core.llm.deterministic_context import ContextResolutionOutcome
from app.core.llm.deterministic_context_adapter import DeterministicContextAdapter
from app.core.llm.deterministic_intents import DeterministicContextIntent
from app.core.llm.providers import ProviderAdapterError, ProviderOrchestrator
from app.core.nest_client import NestRoadmapClient
from app.core.prompts import PromptRepository
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import get_edit_mode_tools

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
    tokens_input: int | None
    tokens_output: int | None
    tokens_total: int | None
    pending_context_resolution: dict[str, Any] | None
    clear_pending_context_resolution: bool
    is_roadmap_question: bool
    tool_mode: Literal['none', 'context_answer', 'edit_plan']
    trace_id: str | None


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
    tokens_input: int | None = None
    tokens_output: int | None = None
    tokens_total: int | None = None
    pending_context_resolution: dict[str, Any] | None = None
    clear_pending_context_resolution: bool = False
    route_lane: str | None = None
    fastpath_bypass_reason: str | None = None


class LLMPlanner:
    def __init__(self) -> None:
        self._logger = logging.getLogger(__name__)
        self._settings = get_settings()
        self._prompt_repository = PromptRepository()
        self._provider_orchestrator = ProviderOrchestrator(self._settings)
        self._nest_client = NestRoadmapClient()
        self._context_answer_cache = ContextAnswerCache(self._settings.agent_cache_ttl_seconds)
        self._context_tools_executor = ContextToolsExecutor(
            settings=self._settings,
            logger=self._logger,
            nest_client=self._nest_client,
            run_async_context_call=self._run_async_context_call,
        )
        self._deterministic_context_adapter = DeterministicContextAdapter(
            settings=self._settings,
            logger=self._logger,
            execute_context_tool=self._execute_context_tool,
        )
        self._context_answer_service = ContextAnswerService(
            settings=self._settings,
            logger=self._logger,
            provider_orchestrator=self._provider_orchestrator,
            context_answer_cache=self._context_answer_cache,
            execute_context_tool=self._execute_context_tool,
            build_context_cache_key=self._build_context_cache_key,
            chat_fallback_builder=self._rule_based_chat_response,
        )
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

    def preview_intent_classification(
        self,
        user_message: str,
        session_context: dict[str, Any] | None = None,
    ) -> tuple[IntentType, bool]:
        intent = self._heuristic_intent(user_message)
        is_roadmap_question = self._is_roadmap_question(
            intent_type=intent,
            user_message=user_message,
            session_context=session_context or {},
        )
        return intent, is_roadmap_question

    def _get_langgraph_disabled_reason(self) -> str | None:
        if StateGraph is None or END is None:
            return 'langgraph import failed'
        return None

    def _build_graph(self) -> Any:
        graph = StateGraph(PlannerState)
        graph.add_node('classify_intent', self._classify_intent)
        graph.add_node('compose_dynamic_system_prompt', self._compose_dynamic_system_prompt)
        graph.add_node('generate_chat_reply', self._generate_chat_reply)
        graph.add_node('generate_context_answer', self._generate_context_answer)
        graph.add_node('plan_operations', self._plan_operations)
        graph.add_node('persist_session_state', self._persist_session_state)

        graph.set_entry_point('classify_intent')
        graph.add_edge('classify_intent', 'compose_dynamic_system_prompt')
        graph.add_conditional_edges(
            'compose_dynamic_system_prompt',
            self._route_from_intent,
            {
                'generate_chat_reply': 'generate_chat_reply',
                'generate_context_answer': 'generate_context_answer',
                'plan_operations': 'plan_operations',
            },
        )
        graph.add_edge('generate_chat_reply', 'persist_session_state')
        graph.add_edge('generate_context_answer', 'persist_session_state')
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
            tokens_input=state.get('tokens_input'),
            tokens_output=state.get('tokens_output'),
            tokens_total=state.get('tokens_total'),
            pending_context_resolution=state.get('pending_context_resolution'),
            clear_pending_context_resolution=bool(state.get('clear_pending_context_resolution', False)),
        )

    def _classify_intent(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        session_context = state.get('session_context', {})
        trace_id = session_context.get('trace_id')
        heuristic_intent = self._heuristic_intent(user_message)
        is_roadmap_question = self._is_roadmap_question(
            intent_type=heuristic_intent,
            user_message=user_message,
            session_context=session_context,
        )
        parse_mode = 'heuristic_prerouter'
        log_event(
            self._logger,
            'intent_classified',
            settings=self._settings,
            trace_id=trace_id,
            intent_type=heuristic_intent,
            is_roadmap_question=is_roadmap_question,
            parse_mode=parse_mode,
        )
        return {
            'intent_type': heuristic_intent,
            'parse_mode': parse_mode,
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': None,
            'is_roadmap_question': is_roadmap_question,
        }

    def _compose_dynamic_system_prompt(self, state: PlannerState) -> PlannerState:
        intent_type = state.get('intent_type', 'unclear')
        mode = 'edit' if intent_type == 'roadmap_edit' else 'chat'
        session_context = state.get('session_context', {})
        trace_id = session_context.get('trace_id')
        prompt_context = {
            'roadmap_id': session_context.get('roadmap_id'),
            'base_revision': session_context.get('base_revision'),
            'revision_token': session_context.get('revision_token'),
            'staged_operations_count': len(state.get('existing_operations', [])),
            'recent_messages': session_context.get('recent_messages', []),
            'actor_context': session_context.get('actor_context'),
            'intent_type': intent_type,
        }
        system_prompt = self._prompt_repository.build_system_prompt(mode=mode, context=prompt_context)
        response_mode: ResponseMode = 'edit_plan' if intent_type == 'roadmap_edit' else 'chat'
        tool_mode: Literal['none', 'context_answer', 'edit_plan']
        if intent_type == 'roadmap_edit':
            tool_mode = 'edit_plan'
        elif state.get('is_roadmap_question'):
            tool_mode = 'context_answer'
        else:
            tool_mode = 'none'

        log_event(
            self._logger,
            'route_selected',
            settings=self._settings,
            trace_id=trace_id,
            intent_type=intent_type,
            tool_mode=tool_mode,
            response_mode=response_mode,
        )
        return {
            'system_prompt': system_prompt,
            'response_mode': response_mode,
            'tool_mode': tool_mode,
            'trace_id': trace_id,
        }

    def _route_from_intent(self, state: PlannerState) -> str:
        tool_mode = state.get('tool_mode', 'none')
        if tool_mode == 'edit_plan':
            return 'plan_operations'
        if tool_mode == 'context_answer':
            return 'generate_context_answer'
        return 'generate_chat_reply'

    def _generate_chat_reply(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        system_prompt = state.get('system_prompt', '')
        session_context = state.get('session_context', {})
        history_messages = self._build_history_messages(session_context)
        trace_id = session_context.get('trace_id')
        fallback_response = self._rule_based_chat_response(user_message, state.get('intent_type', 'unclear'))

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.generate_chat_reply(
                    system_prompt=system_prompt,
                    user_message=user_message,
                    history_messages=history_messages,
                ),
                trace_context={'trace_id': trace_id, 'phase': 'chat_reply'},
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
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
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
                'tokens_input': exc.tokens_input,
                'tokens_output': exc.tokens_output,
                'tokens_total': exc.tokens_total,
            }

    def _generate_context_answer(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        system_prompt = state.get('system_prompt', '')
        session_context = state.get('session_context', {})
        history_messages = self._build_history_messages(session_context)
        return self._get_context_answer_service().generate(
            user_message=user_message,
            system_prompt=system_prompt,
            session_context=session_context,
            history_messages=history_messages,
            intent_type=state.get('intent_type', 'question'),
        )

    def _get_context_answer_service(self) -> ContextAnswerService:
        service = getattr(self, '_context_answer_service', None)
        if service is None:
            service = ContextAnswerService(
                settings=self._settings,
                logger=self._logger,
                provider_orchestrator=self._provider_orchestrator,
                context_answer_cache=self._context_answer_cache,
                execute_context_tool=self._execute_context_tool,
                build_context_cache_key=self._build_context_cache_key,
                chat_fallback_builder=self._rule_based_chat_response,
            )
            self._context_answer_service = service
        return service

    def _plan_operations(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        existing_operations = state.get('existing_operations', [])
        system_prompt = state.get('system_prompt', '')
        session_context = state.get('session_context', {})
        history_messages = self._build_history_messages(session_context)
        trace_id = session_context.get('trace_id')
        fallback = self._rule_based_operation_plan(user_message)
        tool_definitions = get_edit_mode_tools()
        edit_turns = self._settings.max_edit_tool_turns

        planner_prompt = (
            'You are in edit planning mode.\n'
            'Resolve named targets to node IDs with resolve_node_reference before asking for IDs.\n'
            'Use context tools when needed to resolve node IDs and hierarchy before drafting operations.\n'
            'When ready, call plan_roadmap_operations exactly once with assistant_message and operations.\n'
            'Do not call commit or discard tools. Commit remains a UI action.\n'
            'Current staged operations:\n'
            f'{json.dumps([op.model_dump(exclude_none=True) for op in existing_operations])}\n\n'
            'Roadmap ID:\n'
            f'{session_context.get("roadmap_id")}\n\n'
            'User request:\n'
            f'{user_message}\n\n'
            'If request is ambiguous, use context tools first, then produce the safest possible operation plan.'
        )

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.plan_operations_with_tools(
                    system_prompt=system_prompt,
                    planner_prompt=planner_prompt,
                    history_messages=history_messages,
                    tools=tool_definitions,
                    tool_executor=lambda name, args: self._execute_context_tool(name, args, session_context),
                    max_tool_turns=edit_turns,
                ),
                trace_context={'trace_id': trace_id, 'phase': 'edit_plan'},
            )
            assistant_message, operations = result.value
            log_event(
                self._logger,
                'plan_generated',
                settings=self._settings,
                trace_id=trace_id,
                provider_used=result.provider_used,
                fallback_used=result.fallback_used,
                operations_count=len(operations),
                operation_types=[op.op.value for op in operations],
                tokens_input=result.tokens_input,
                tokens_output=result.tokens_output,
                tokens_total=result.tokens_total,
            )
            return {
                'assistant_message': assistant_message,
                'planned_operations': operations,
                'response_mode': 'edit_plan',
                'preview_recommended': bool(operations),
                'parse_mode': f'{result.provider_used}_tool_calling',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': result.provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
            }
        except ProviderAdapterError as exc:
            if exc.code == 'invalid_operation_payload':
                log_event(
                    self._logger,
                    'plan_payload_invalid',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    error_code=exc.code,
                    error_message=exc.message,
                    tokens_input=exc.tokens_input,
                    tokens_output=exc.tokens_output,
                    tokens_total=exc.tokens_total,
                )
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
                'tokens_input': exc.tokens_input,
                'tokens_output': exc.tokens_output,
                'tokens_total': exc.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
            }

    def _execute_context_tool(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        return self._get_context_tools_executor().execute(
            tool_name=tool_name,
            args=args,
            session_context=session_context,
        )

    def _get_context_tools_executor(self) -> ContextToolsExecutor:
        executor = getattr(self, '_context_tools_executor', None)
        if executor is None:
            executor = ContextToolsExecutor(
                settings=self._settings,
                logger=self._logger,
                nest_client=self._nest_client,
                run_async_context_call=self._run_async_context_call,
            )
            self._context_tools_executor = executor
        return executor

    def _get_deterministic_context_adapter(self) -> DeterministicContextAdapter:
        adapter = getattr(self, '_deterministic_context_adapter', None)
        if adapter is None:
            adapter = DeterministicContextAdapter(
                settings=self._settings,
                logger=self._logger,
                execute_context_tool=self._execute_context_tool,
            )
            self._deterministic_context_adapter = adapter
        return adapter

    def _try_pending_context_selection(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return self._get_deterministic_context_adapter().try_pending_context_selection(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def _try_deterministic_features_answer(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return self._get_deterministic_context_adapter().try_deterministic_features_answer(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def _try_deterministic_tasks_answer(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return self._get_deterministic_context_adapter().try_deterministic_tasks_answer(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def _match_deterministic_context_intent(
        self,
        user_message: str,
    ) -> tuple[DeterministicContextIntent, str] | None:
        return self._get_deterministic_context_adapter().match_deterministic_context_intent(user_message)

    def _get_deterministic_context_intent(
        self,
        pending_kind: str,
    ) -> DeterministicContextIntent | None:
        return self._get_deterministic_context_adapter().get_deterministic_context_intent(pending_kind)

    def _match_global_overview_intent(
        self,
        user_message: str,
    ) -> tuple[DeterministicContextIntent, str] | None:
        return self._get_deterministic_context_adapter().match_global_overview_intent(user_message)

    def _try_deterministic_list_answer(
        self,
        *,
        intent: DeterministicContextIntent,
        label: str,
        include_ids: bool,
        user_message: str | None = None,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return self._get_deterministic_context_adapter().try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=include_ids,
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )

    def _normalize_context_label(self, label: str) -> str:
        return self._get_deterministic_context_adapter().normalize_context_label(label)

    def _should_include_ids(self, user_message: str) -> bool:
        return self._get_deterministic_context_adapter().should_include_ids(user_message)

    def _persist_session_state(self, _state: PlannerState) -> PlannerState:
        return {}

    def _run_async_context_call(self, coro: Any) -> dict[str, Any]:
        # Planner execution runs in a worker thread, so this safely drives async I/O
        # for context tools without blocking the main event loop.
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)
        raise RuntimeError('Context tool call attempted on running event loop thread')

    def _build_classifier_input(self, user_message: str, session_context: dict[str, Any]) -> str:
        payload = {
            'user_message': user_message,
            'roadmap_id': session_context.get('roadmap_id'),
            'base_revision': session_context.get('base_revision'),
            'revision_token': session_context.get('revision_token'),
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
        if re.fullmatch(r'(h+i+|h+e+y+|h+e+l+o+|y+o+)', text) or text in {
            'good morning',
            'good afternoon',
            'good evening',
        }:
            return 'smalltalk'
        if re.search(r'\b(add|create|move|delete|remove|update|mark|shift|link|unlink|rename|retitle|change)\b', text):
            return 'roadmap_edit'
        if text.endswith('?') or re.search(r'^(what|why|how|when|where|can you|could you|do we)\b', text):
            return 'question'
        return 'unclear'

    def _is_roadmap_question(
        self,
        *,
        intent_type: IntentType,
        user_message: str,
        session_context: dict[str, Any],
    ) -> bool:
        if not session_context.get('roadmap_id'):
            return False
        if intent_type == 'roadmap_edit':
            return False
        lowered = user_message.strip().lower()
        roadmap_keywords = (
            'roadmap',
            'epic',
            'feature',
            'task',
            'status',
            'timeline',
            'dependency',
            'milestone',
        )
        if any(keyword in lowered for keyword in roadmap_keywords):
            return True
        return intent_type in {'question', 'unclear'}

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
                'I can help with normal chat or roadmap edits. If you keep seeing this style of response, '
                'the model provider is likely unavailable or out of quota. '
                'If you want edits, describe the action and target node IDs, then we can generate a preview.'
            )
        return 'Tell me what you want to do, and I will help.'

    def _rule_based_operation_plan(self, user_message: str) -> PlanningResult:
        text = user_message.strip()
        operations: list[RoadmapOperation] = []
        uuid_match = re.search(r'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', text)

        rename_match = re.search(
            r'(?:rename|retitle|change(?:\s+the)?\s+name(?:\s+of)?)\b.*?(?:to|as)\s+[\"\']([^\"\']+)[\"\']',
            text,
            re.IGNORECASE,
        )
        if rename_match and uuid_match:
            operations.append(
                RoadmapOperation(
                    op='update_node',
                    node_id=uuid_match.group(1),
                    patch={'title': rename_match.group(1).strip()},
                )
            )

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

    def _build_context_cache_key(
        self,
        *,
        roadmap_id: str,
        user_message: str,
        roadmap_updated_token: Any,
        actor_id: str | None = None,
    ) -> str:
        normalized_question = ' '.join(user_message.strip().lower().split())
        token = str(roadmap_updated_token if roadmap_updated_token is not None else 'none')
        actor_scope = actor_id or 'anonymous'
        hashed_question = hashlib.sha256(normalized_question.encode('utf-8')).hexdigest()
        return f'{roadmap_id}:{actor_scope}:{token}:{hashed_question}'

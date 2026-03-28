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
from app.core.logging_utils import log_event, summarize_tool_result
from app.core.llm.providers import ProviderAdapterError, ProviderOrchestrator
from app.core.nest_client import NestRoadmapClient
from app.core.orchestration.edit_resolver import resolve_candidates
from app.core.prompts import PromptRepository
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import CONTEXT_TOOL_NAMES, get_context_tools, get_edit_mode_tools

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


class LLMPlanner:
    def __init__(self) -> None:
        self._logger = logging.getLogger(__name__)
        self._settings = get_settings()
        self._prompt_repository = PromptRepository()
        self._provider_orchestrator = ProviderOrchestrator(self._settings)
        self._nest_client = NestRoadmapClient()
        self._context_answer_cache = ContextAnswerCache(self._settings.agent_cache_ttl_seconds)
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
        trace_id = session_context.get('trace_id')
        context_tools = get_context_tools()
        fallback_response = self._rule_based_chat_response(user_message, state.get('intent_type', 'question'))
        cache_key = self._build_context_cache_key(
            roadmap_id=str(session_context.get('roadmap_id') or ''),
            user_message=user_message,
            roadmap_updated_token=(
                session_context.get('revision_token')
                or session_context.get('base_revision')
            ),
        )
        cached_answer = self._context_answer_cache.get(cache_key)
        if cached_answer:
            log_event(
                self._logger,
                'cache_hit',
                settings=self._settings,
                trace_id=trace_id,
                cache_scope='context_answer',
                roadmap_id=session_context.get('roadmap_id'),
            )
            return {
                'assistant_message': cached_answer,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'context_cache_hit',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': None,
            }
        log_event(
            self._logger,
            'cache_miss',
            settings=self._settings,
            trace_id=trace_id,
            cache_scope='context_answer',
            roadmap_id=session_context.get('roadmap_id'),
        )
        context_turns = self._settings.max_context_tool_turns

        question_prompt = (
            'Answer the user question about the roadmap.\n'
            'Use available context tools when the answer depends on roadmap data.\n'
            'Do not plan edit operations in this mode.\n\n'
            f'Roadmap ID: {session_context.get("roadmap_id")}\n'
            f'User question: {user_message}'
        )

        try:
            result = self._provider_orchestrator.call(
                lambda adapter: adapter.answer_with_tools(
                    system_prompt=system_prompt,
                    question_prompt=question_prompt,
                    history_messages=history_messages,
                    tools=context_tools,
                    tool_executor=lambda name, args: self._execute_context_tool(name, args, session_context),
                    max_tool_turns=context_turns,
                ),
                trace_context={'trace_id': trace_id, 'phase': 'context_answer'},
            )
            log_event(
                self._logger,
                'context_answer_generated',
                settings=self._settings,
                trace_id=trace_id,
                provider_used=result.provider_used,
                fallback_used=result.fallback_used,
            )
            self._context_answer_cache.set(cache_key, result.value)
            return {
                'assistant_message': result.value,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_context_tools',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': result.provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
            }
        except ProviderAdapterError as exc:
            self._logger.warning(
                'Provider context answer failed, using chat fallback. code=%s message=%s',
                exc.code,
                exc.message,
            )
            return {
                'assistant_message': fallback_response,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'rule_based_context_chat',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': exc.code,
                'tokens_input': exc.tokens_input,
                'tokens_output': exc.tokens_output,
                'tokens_total': exc.tokens_total,
            }

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
            }

    def _execute_context_tool(
        self,
        tool_name: str,
        args: dict[str, Any],
        session_context: dict[str, Any],
    ) -> dict[str, Any]:
        trace_id = session_context.get('trace_id')
        if tool_name not in CONTEXT_TOOL_NAMES:
            result = {
                'error': {
                    'code': 'UNKNOWN_TOOL',
                    'message': f'Tool {tool_name} is not available in edit mode.',
                }
            }
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        roadmap_id = str(args.get('roadmap_id') or session_context.get('roadmap_id') or '').strip()
        session_roadmap_id = str(session_context.get('roadmap_id') or '').strip()
        if not roadmap_id:
            result = {
                'error': {
                    'code': 'MISSING_ROADMAP_ID',
                    'message': 'roadmap_id is required for context tools.',
                }
            }
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result
        if session_roadmap_id and roadmap_id != session_roadmap_id:
            result = {
                'error': {
                    'code': 'ROADMAP_SCOPE_MISMATCH',
                    'message': 'Context tools must use the active session roadmap_id.',
                }
            }
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result

        auth_header = session_context.get('auth_header')
        auth_value = auth_header if isinstance(auth_header, str) and auth_header else None
        log_event(
            self._logger,
            'tool_call_requested',
            settings=self._settings,
            trace_id=trace_id,
            tool_name=tool_name,
            tool_args=args,
            arg_keys=sorted(args.keys()),
            roadmap_id=roadmap_id,
        )

        try:
            result: dict[str, Any]
            if tool_name == 'get_roadmap_summary':
                result = self._run_async_context_call(
                    self._nest_client.context_summary(
                        roadmap_id=roadmap_id,
                        auth_header=auth_value,
                    )
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'search_nodes':
                query = str(args.get('query', '')).strip()
                if not query:
                    result = {
                        'error': {
                            'code': 'MISSING_QUERY',
                            'message': 'query is required for search_nodes.',
                        }
                    }
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else None
                result = self._run_async_context_call(
                    self._nest_client.context_search(
                        roadmap_id=roadmap_id,
                        query=query,
                        limit=limit,
                        auth_header=auth_value,
                    )
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'resolve_node_reference':
                label = str(args.get('label', '')).strip()
                if not label:
                    result = {
                        'error': {
                            'code': 'MISSING_LABEL',
                            'message': 'label is required for resolve_node_reference.',
                        }
                    }
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                node_type_raw = str(args.get('node_type', '')).strip().lower()
                node_type = node_type_raw if node_type_raw in {'epic', 'feature', 'task'} else None
                limit_raw = args.get('limit')
                limit = int(limit_raw) if isinstance(limit_raw, int) else 20
                search_result = self._run_async_context_call(
                    self._nest_client.context_search(
                        roadmap_id=roadmap_id,
                        query=label,
                        limit=limit,
                        auth_header=auth_value,
                    )
                )
                raw_matches = search_result.get('matches', [])
                if not isinstance(raw_matches, list):
                    raw_matches = []
                resolved = resolve_candidates(
                    raw_matches,
                    label=label,
                    node_type=node_type,
                )
                result = {
                    'status': resolved.status,
                    'selected': (
                        resolved.selected.model_dump(exclude_none=True)
                        if resolved.selected is not None
                        else None
                    ),
                    'matches': [
                        item.model_dump(exclude_none=True)
                        for item in resolved.candidates[:5]
                    ],
                }
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            if tool_name == 'get_node_details':
                node_id = str(args.get('node_id', '')).strip()
                if not node_id:
                    result = {
                        'error': {
                            'code': 'MISSING_NODE_ID',
                            'message': 'node_id is required for get_node_details.',
                        }
                    }
                    log_event(
                        self._logger,
                        'tool_call_result',
                        settings=self._settings,
                        level=logging.WARNING,
                        trace_id=trace_id,
                        tool_name=tool_name,
                        result_summary=summarize_tool_result(result),
                    )
                    return result
                result = self._run_async_context_call(
                    self._nest_client.context_node_details(
                        roadmap_id=roadmap_id,
                        node_id=node_id,
                        auth_header=auth_value,
                    )
                )
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result

            parent_id = str(args.get('parent_id', '')).strip()
            if not parent_id:
                result = {
                    'error': {
                        'code': 'MISSING_PARENT_ID',
                        'message': 'parent_id is required for get_children.',
                    }
                }
                log_event(
                    self._logger,
                    'tool_call_result',
                    settings=self._settings,
                    level=logging.WARNING,
                    trace_id=trace_id,
                    tool_name=tool_name,
                    result_summary=summarize_tool_result(result),
                )
                return result
            limit_raw = args.get('limit')
            limit = int(limit_raw) if isinstance(limit_raw, int) else None
            result = self._run_async_context_call(
                self._nest_client.context_children(
                    roadmap_id=roadmap_id,
                    node_id=parent_id,
                    limit=limit,
                    auth_header=auth_value,
                )
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary=summarize_tool_result(result),
            )
            return result
        except Exception as exc:  # pragma: no cover
            self._logger.warning(
                'Context tool execution failed. tool=%s roadmap_id=%s error=%s',
                tool_name,
                roadmap_id,
                exc,
            )
            log_event(
                self._logger,
                'tool_call_result',
                settings=self._settings,
                level=logging.WARNING,
                trace_id=trace_id,
                tool_name=tool_name,
                result_summary={'result_type': 'error', 'error_code': 'CONTEXT_TOOL_FAILED'},
            )
            return {
                'error': {
                    'code': 'CONTEXT_TOOL_FAILED',
                    'message': 'Failed to fetch roadmap context from backend.',
                }
            }

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
    ) -> str:
        normalized_question = ' '.join(user_message.strip().lower().split())
        token = str(roadmap_updated_token if roadmap_updated_token is not None else 'none')
        hashed_question = hashlib.sha256(normalized_question.encode('utf-8')).hexdigest()
        return f'{roadmap_id}:{token}:{hashed_question}'

from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal, TypedDict

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ProviderUsed, ResponseMode
from app.core.logging_utils import log_event
from app.core.llm.clarifier_contract import build_clarifier_contract
from app.core.llm.context_answer_service import ContextAnswerService
from app.core.llm.context_tools_executor import ContextToolsExecutor
from app.core.llm.deterministic_context import ContextResolutionOutcome
from app.core.llm.deterministic_context_adapter import DeterministicContextAdapter
from app.core.llm.deterministic_intents import DeterministicContextIntent
from app.core.llm.react_executor import map_provider_error_to_stop_reason
from app.core.llm.providers import ProviderAdapterError, ProviderOrchestrator
from app.core.nest_client import NestRoadmapClient
from app.core.prompts import PromptRepository
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import get_edit_mode_tools, parse_plan_tool_args

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
    clarifier_action: str | None
    clarifier_reason: str | None
    clarifier_options: list[str] | None
    clarifier_schema_retries: int | None
    planner_schema_invalid_attempts: int | None
    planner_repair_attempted: bool | None
    force_edit_continuation: bool
    force_edit_continuation_reason: str | None
    draft_action: str | None
    tool_plan: list[dict[str, Any]]
    needs_more_info: bool | None
    stop_reason: str | None


class _EditClarifierPayload(BaseModel):
    action: Literal['ask_clarifier', 'propose_safe_default', 'cannot_proceed']
    reason: str
    question: str
    options: list[str]


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
    clarifier_action: str | None = None
    clarifier_reason: str | None = None
    clarifier_options: list[str] | None = None
    clarifier_schema_retries: int | None = None
    planner_schema_invalid_attempts: int | None = None
    planner_repair_attempted: bool | None = None
    draft_action: str | None = None
    tool_plan: list[dict[str, Any]] | None = None
    needs_more_info: bool | None = None
    stop_reason: str | None = None


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

        operations = state.get('planned_operations', [])
        intent_type = state.get('intent_type', 'unclear')
        response_mode = state.get('response_mode', 'chat')
        provider_error_code = state.get('provider_error_code')

        draft_action = state.get('draft_action')
        tool_plan = state.get('tool_plan')
        needs_more_info = state.get('needs_more_info')
        stop_reason = state.get('stop_reason')

        if response_mode == 'edit_plan':
            if draft_action is None:
                draft_action = 'continue'
            if tool_plan is None:
                tool_plan = []
            if needs_more_info is None:
                needs_more_info = False
            if stop_reason is None:
                stop_reason = 'ready_to_stage' if operations else 'awaiting_user_input'
        elif intent_type == 'roadmap_edit':
            if draft_action is None:
                draft_action = 'continue'
            if tool_plan is None:
                tool_plan = []
            if needs_more_info is None:
                needs_more_info = True
            if stop_reason is None:
                stop_reason = (
                    map_provider_error_to_stop_reason(provider_error_code)
                    or 'awaiting_user_input'
                )

        return PlanningResult(
            assistant_message=state.get('assistant_message', 'I can help with that.'),
            operations=operations,
            parse_mode=state.get('parse_mode', 'rule_based_chat'),
            intent_type=intent_type,
            response_mode=response_mode,
            preview_recommended=bool(state.get('preview_recommended', False)),
            provider_used=state.get('provider_used', 'rule_based'),
            fallback_used=bool(state.get('fallback_used', False)),
            provider_error_code=provider_error_code,
            tokens_input=state.get('tokens_input'),
            tokens_output=state.get('tokens_output'),
            tokens_total=state.get('tokens_total'),
            pending_context_resolution=state.get('pending_context_resolution'),
            clear_pending_context_resolution=bool(state.get('clear_pending_context_resolution', False)),
            clarifier_action=state.get('clarifier_action'),
            clarifier_reason=state.get('clarifier_reason'),
            clarifier_options=state.get('clarifier_options'),
            clarifier_schema_retries=state.get('clarifier_schema_retries'),
            planner_schema_invalid_attempts=state.get('planner_schema_invalid_attempts'),
            planner_repair_attempted=state.get('planner_repair_attempted'),
            draft_action=draft_action,
            tool_plan=tool_plan,
            needs_more_info=needs_more_info,
            stop_reason=stop_reason,
        )

    def _classify_intent(self, state: PlannerState) -> PlannerState:
        user_message = state.get('user_message', '')
        session_context = state.get('session_context', {})
        trace_id = session_context.get('trace_id')
        force_edit_continuation = bool(session_context.get('force_edit_continuation'))
        force_reason = str(session_context.get('force_edit_continuation_reason') or '').strip() or None
        if force_edit_continuation:
            parse_mode = 'deterministic_edit_continuation_override'
            log_event(
                self._logger,
                'intent_classified',
                settings=self._settings,
                trace_id=trace_id,
                intent_type='roadmap_edit',
                is_roadmap_question=False,
                parse_mode=parse_mode,
            )
            return {
                'intent_type': 'roadmap_edit',
                'parse_mode': parse_mode,
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': None,
                'is_roadmap_question': False,
                'force_edit_continuation': True,
                'force_edit_continuation_reason': force_reason,
            }
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
        if state.get('force_edit_continuation'):
            intent_type = 'roadmap_edit'
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
        tool_definitions = get_edit_mode_tools()
        edit_turns = max(1, int(self._settings.max_edit_tool_turns))
        max_attempts = max(1, self._settings.agent_react_max_attempts)
        max_repair_retries = max(0, self._settings.agent_react_repair_retries)
        max_attempts = min(max_attempts, max_repair_retries + 1)
        tool_observations: list[dict[str, Any]] = []

        def _capturing_tool_executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
            result = self._execute_context_tool(name, args, session_context)
            tool_observations.append(
                {
                    'tool_name': name,
                    'args': dict(args) if isinstance(args, dict) else {},
                    'result': result,
                }
            )
            return result

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
        schema_invalid_attempts = 0
        repair_attempted = False
        last_provider_error_code: str | None = None

        for attempt in range(max_attempts):
            if attempt > 0:
                repair_attempted = True
            try:
                result = self._provider_orchestrator.call(
                    lambda adapter: adapter.plan_operations_with_tools(
                        system_prompt=system_prompt,
                        planner_prompt=planner_prompt,
                        history_messages=history_messages,
                        tools=tool_definitions,
                        tool_executor=_capturing_tool_executor,
                        max_tool_turns=edit_turns,
                    ),
                    trace_context={'trace_id': trace_id, 'phase': 'edit_plan'},
                )
            except ProviderAdapterError as exc:
                last_provider_error_code = exc.code
                if exc.code == 'max_tool_turns_exceeded':
                    self._logger.warning(
                        'Edit tool-call budget exhausted; escalating to clarifier. code=%s message=%s',
                        exc.code,
                        exc.message,
                    )
                    return self._build_edit_clarifier_state(
                        user_message=user_message,
                        system_prompt=system_prompt,
                        history_messages=history_messages,
                        trace_id=trace_id,
                        provider_error_code=exc.code,
                    )
                if exc.code in {'invalid_operation_payload', 'missing_tool_call'} and attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                self._logger.warning(
                    'Provider operation planning failed in react mode, using edit clarifier lane. code=%s message=%s',
                    exc.code,
                    exc.message,
                )
                synthesized_operations = self._maybe_synthesize_react_closure_operations(
                    user_message=user_message,
                    tool_observations=tool_observations,
                )
                if synthesized_operations:
                    return self._build_synthesized_react_closure_state(
                        operations=synthesized_operations,
                        schema_invalid_attempts=schema_invalid_attempts,
                        repair_attempted=repair_attempted,
                        draft_action='continue',
                        tool_plan=[],
                    )
                return self._build_edit_clarifier_state(
                    user_message=user_message,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    trace_id=trace_id,
                    provider_error_code=exc.code,
                )

            if not isinstance(result.value, tuple) or len(result.value) != 2:
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                break

            assistant_message, raw_operations = result.value
            assistant_message = (
                assistant_message if isinstance(assistant_message, str) else str(assistant_message or '')
            )
            if raw_operations is None:
                operations: list[RoadmapOperation] = []
            elif isinstance(raw_operations, list):
                try:
                    _, operations = parse_plan_tool_args(
                        {
                            'assistant_message': assistant_message or 'Prepared roadmap edit operations.',
                            'operations': raw_operations,
                        }
                    )
                except Exception:
                    if attempt + 1 < max_attempts:
                        schema_invalid_attempts += 1
                        repair_attempted = True
                        continue
                    break
            else:
                if attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    continue
                break

            if operations:
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
                    'assistant_message': (
                        assistant_message.strip()
                        if isinstance(assistant_message, str) and assistant_message.strip()
                        else 'Prepared roadmap edit operations.'
                    ),
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
                    'clarifier_action': None,
                    'clarifier_reason': None,
                    'clarifier_options': None,
                    'clarifier_schema_retries': schema_invalid_attempts,
                    'planner_schema_invalid_attempts': schema_invalid_attempts,
                    'planner_repair_attempted': repair_attempted,
                    'draft_action': 'continue',
                    'tool_plan': [],
                    'needs_more_info': False,
                    'stop_reason': 'ready_to_stage',
                }

            synthesized_operations = self._maybe_synthesize_react_closure_operations(
                user_message=user_message,
                tool_observations=tool_observations,
            )
            if synthesized_operations:
                return self._build_synthesized_react_closure_state(
                    operations=synthesized_operations,
                    schema_invalid_attempts=schema_invalid_attempts,
                    repair_attempted=repair_attempted,
                    draft_action='continue',
                    tool_plan=[],
                    tokens_input=result.tokens_input,
                    tokens_output=result.tokens_output,
                    tokens_total=result.tokens_total,
                )
            clarifier_message = (
                assistant_message.strip()
                if isinstance(assistant_message, str) and assistant_message.strip()
                else (
                    'I can help with that edit. Could you confirm the exact target '
                    'or provide the node ID so I can stage the operation safely?'
                )
            )
            clarifier_action = 'ask_clarifier'
            clarifier_reason = 'discovery_unresolved'
            clarifier_options = [
                'Confirm the exact target label',
                'Provide the node ID',
                'Cancel',
            ]
            clarifier_message, clarifier_options = build_clarifier_contract(
                reason=clarifier_reason,
                question=clarifier_message,
                options=clarifier_options,
            )
            return {
                'assistant_message': clarifier_message,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': f'{result.provider_used}_tool_calling_clarifier',
                'provider_used': result.provider_used,
                'fallback_used': result.fallback_used,
                'provider_error_code': last_provider_error_code or result.provider_error_code,
                'tokens_input': result.tokens_input,
                'tokens_output': result.tokens_output,
                'tokens_total': result.tokens_total,
                'pending_context_resolution': None,
                'clear_pending_context_resolution': False,
                'clarifier_action': clarifier_action,
                'clarifier_reason': clarifier_reason,
                'clarifier_options': clarifier_options,
                'clarifier_schema_retries': schema_invalid_attempts,
                'planner_schema_invalid_attempts': schema_invalid_attempts,
                'planner_repair_attempted': repair_attempted,
                'draft_action': 'continue',
                'tool_plan': [],
                'needs_more_info': True,
                'stop_reason': 'awaiting_user_input',
            }

        synthesized_operations = self._maybe_synthesize_react_closure_operations(
            user_message=user_message,
            tool_observations=tool_observations,
        )
        if synthesized_operations:
            return self._build_synthesized_react_closure_state(
                operations=synthesized_operations,
                schema_invalid_attempts=schema_invalid_attempts,
                repair_attempted=repair_attempted,
                draft_action='continue',
                tool_plan=[],
            )

        return self._neutral_edit_clarifier_state(
            provider_error_code=last_provider_error_code or 'invalid_planner_schema',
            schema_retries=schema_invalid_attempts,
        )

    def _build_synthesized_react_closure_state(
        self,
        *,
        operations: list[RoadmapOperation],
        schema_invalid_attempts: int,
        repair_attempted: bool,
        draft_action: str,
        tool_plan: list[dict[str, Any]],
        tokens_input: int | None = None,
        tokens_output: int | None = None,
        tokens_total: int | None = None,
    ) -> PlannerState:
        return {
            'assistant_message': 'Prepared roadmap edit operations from resolved target context.',
            'planned_operations': operations,
            'response_mode': 'edit_plan',
            'preview_recommended': True,
            'parse_mode': 'deterministic_react_tool_closure',
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': None,
            'tokens_input': tokens_input,
            'tokens_output': tokens_output,
            'tokens_total': tokens_total,
            'pending_context_resolution': None,
            'clear_pending_context_resolution': False,
            'clarifier_action': None,
            'clarifier_reason': None,
            'clarifier_options': None,
            'clarifier_schema_retries': schema_invalid_attempts,
            'planner_schema_invalid_attempts': schema_invalid_attempts,
            'planner_repair_attempted': repair_attempted,
            'draft_action': draft_action,
            'tool_plan': tool_plan,
            'needs_more_info': False,
            'stop_reason': 'ready_to_stage',
        }

    def _maybe_synthesize_react_closure_operations(
        self,
        *,
        user_message: str,
        tool_observations: list[dict[str, Any]],
    ) -> list[RoadmapOperation] | None:
        rename_labels = self._extract_rename_request_labels(user_message)
        if rename_labels is None:
            return None

        from_label, to_title = rename_labels
        normalized_from_label = self._normalize_label_for_matching(from_label)
        for observation in reversed(tool_observations):
            if str(observation.get('tool_name') or '').strip() != 'resolve_node_reference':
                continue
            args = observation.get('args')
            result = observation.get('result')
            if not isinstance(args, dict) or not isinstance(result, dict):
                continue

            status = str(result.get('status') or '').strip().lower()
            selected_payload = result.get('selected')
            if not isinstance(selected_payload, dict):
                matches_payload = result.get('matches')
                if (
                    status == 'unique'
                    and isinstance(matches_payload, list)
                    and len(matches_payload) == 1
                    and isinstance(matches_payload[0], dict)
                ):
                    selected_payload = matches_payload[0]

            if status != 'unique' or not isinstance(selected_payload, dict):
                continue

            requested_label = str(args.get('label') or '').strip()
            normalized_requested_label = self._normalize_label_for_matching(requested_label)
            if normalized_from_label and normalized_requested_label:
                if (
                    normalized_from_label != normalized_requested_label
                    and normalized_from_label not in normalized_requested_label
                    and normalized_requested_label not in normalized_from_label
                ):
                    continue

            node_id = str(selected_payload.get('id') or '').strip()
            if not re.fullmatch(
                r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                node_id,
            ):
                continue

            return [
                RoadmapOperation(
                    op='update_node',
                    node_id=node_id,
                    patch={'title': to_title},
                )
            ]
        return None

    def _extract_rename_request_labels(self, user_message: str) -> tuple[str, str] | None:
        text = ' '.join(user_message.strip().split())
        if not text:
            return None

        patterns = [
            r'(?i)\b(?:rename|retitle)\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
            r'(?i)\bchange(?:\s+the)?\s+name(?:\s+of)?\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|as)\s+(.+)$',
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match is None:
                continue
            from_label = self._strip_quotes_and_punctuation(match.group(1))
            to_title = self._strip_quotes_and_punctuation(match.group(2))
            if from_label and to_title:
                return from_label, to_title
        return None

    @staticmethod
    def _strip_quotes_and_punctuation(value: str) -> str:
        cleaned = value.strip()
        cleaned = cleaned.strip('"\'`')
        cleaned = re.sub(r'[.?!,;:]+$', '', cleaned)
        return ' '.join(cleaned.split())

    @staticmethod
    def _normalize_label_for_matching(value: str) -> str:
        lowered = value.lower().strip()
        normalized = re.sub(r'[^a-z0-9]+', ' ', lowered)
        return ' '.join(normalized.split())

    def _build_edit_clarifier_state(
        self,
        *,
        user_message: str,
        system_prompt: str,
        history_messages: list[Any],
        trace_id: str | None,
        provider_error_code: str,
    ) -> PlannerState:
        clarification_prompt = self._build_edit_clarifier_prompt(user_message=user_message)
        schema_retries = 0
        parse_error_code: str | None = None
        stop_reason = map_provider_error_to_stop_reason(provider_error_code)

        for attempt in range(2):
            try:
                result = self._provider_orchestrator.call(
                    lambda adapter: adapter.generate_chat_reply(
                        system_prompt=system_prompt,
                        user_message=clarification_prompt,
                        history_messages=history_messages,
                    ),
                    trace_context={'trace_id': trace_id, 'phase': 'edit_clarifier'},
                )
            except ProviderAdapterError as clarifier_exc:
                self._logger.warning(
                    'Provider clarifier generation failed. code=%s message=%s',
                    clarifier_exc.code,
                    clarifier_exc.message,
                )
                return self._neutral_edit_clarifier_state(
                    provider_error_code=provider_error_code,
                    schema_retries=schema_retries,
                    stop_reason=stop_reason,
                )

            try:
                parsed = self._parse_edit_clarifier_payload(result.value)
                assistant_message, clarifier_options = self._format_edit_clarifier_message(parsed)
                log_event(
                    self._logger,
                    'edit_clarifier_generated',
                    settings=self._settings,
                    trace_id=trace_id,
                    clarifier_action=parsed.action,
                    clarifier_schema_retries=schema_retries,
                    provider_used=result.provider_used,
                )
                return {
                    'assistant_message': assistant_message,
                    'planned_operations': [],
                    'response_mode': 'chat',
                    'preview_recommended': False,
                    'parse_mode': f'{result.provider_used}_edit_clarifier',
                    'provider_used': result.provider_used,
                    'fallback_used': result.fallback_used,
                    'provider_error_code': provider_error_code,
                    'tokens_input': result.tokens_input,
                    'tokens_output': result.tokens_output,
                    'tokens_total': result.tokens_total,
                    'pending_context_resolution': None,
                    'clear_pending_context_resolution': False,
                    'clarifier_action': parsed.action,
                    'clarifier_reason': parsed.reason,
                    'clarifier_options': clarifier_options,
                    'clarifier_schema_retries': schema_retries,
                    'planner_schema_invalid_attempts': schema_retries,
                    'planner_repair_attempted': schema_retries > 0,
                    'draft_action': 'continue',
                    'tool_plan': [],
                    'needs_more_info': True,
                    'stop_reason': stop_reason or 'awaiting_user_input',
                }
            except ValueError:
                parse_error_code = 'invalid_clarifier_schema'
                if attempt == 0:
                    schema_retries = 1
                    continue
                break

        return self._neutral_edit_clarifier_state(
            provider_error_code=parse_error_code or provider_error_code,
            schema_retries=schema_retries,
            stop_reason=stop_reason,
        )

    def _build_edit_clarifier_prompt(self, *, user_message: str) -> str:
        return (
            'You are generating an edit clarification response for a roadmap assistant. '
            'Return STRICT JSON only with keys: action, reason, question, options.\n'
            'action must be one of: ask_clarifier, propose_safe_default, cannot_proceed.\n'
            'question must be concise and actionable.\n'
            'options must contain 2-4 short options.\n'
            'Do not include markdown, prose, or code fences.\n'
            'For propose_safe_default, suggest the safest default and ask for explicit confirmation.\n'
            f'User request: {user_message}'
        )

    def _parse_edit_clarifier_payload(self, raw: str) -> _EditClarifierPayload:
        text = raw.strip()
        candidate = text
        if not (text.startswith('{') and text.endswith('}')):
            match = re.search(r'\{.*\}', text, re.DOTALL)
            if match:
                candidate = match.group(0)
        try:
            payload = _EditClarifierPayload.model_validate_json(candidate)
        except Exception as exc:
            raise ValueError('invalid_clarifier_schema') from exc
        if not payload.question.strip():
            raise ValueError('invalid_clarifier_schema')
        cleaned_options = [opt.strip() for opt in payload.options if isinstance(opt, str) and opt.strip()]
        if not cleaned_options:
            raise ValueError('invalid_clarifier_schema')
        if len(cleaned_options) > 5:
            cleaned_options = cleaned_options[:5]
        return payload.model_copy(update={'options': cleaned_options})

    def _format_edit_clarifier_message(self, payload: _EditClarifierPayload) -> tuple[str, list[str]]:
        question = payload.question.strip()
        if payload.action == 'propose_safe_default':
            question = f'{question} Reply "yes" to proceed, or tell me what to change.'
        return build_clarifier_contract(
            reason=payload.reason,
            question=question,
            options=payload.options,
        )

    def _neutral_edit_clarifier_state(
        self,
        *,
        provider_error_code: str | None,
        schema_retries: int,
        stop_reason: str | None = None,
    ) -> PlannerState:
        resolved_stop_reason = (
            stop_reason
            or map_provider_error_to_stop_reason(provider_error_code)
            or 'awaiting_user_input'
        )
        fallback_options = [
            'Create epic "AI Module" at roadmap root',
            'Use a different title',
            'Create under a specific parent',
        ]
        assistant_message, clarifier_options = build_clarifier_contract(
            reason='edit_clarifier_fallback',
            question=(
                'I can help with that edit. Could you confirm the exact action and target '
                '(for example: create epic, rename feature, or move task)?'
            ),
            options=fallback_options,
        )
        return {
            'assistant_message': assistant_message,
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'neutral_edit_clarifier',
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': provider_error_code,
            'tokens_input': None,
            'tokens_output': None,
            'tokens_total': None,
            'pending_context_resolution': None,
            'clear_pending_context_resolution': False,
            'clarifier_action': 'ask_clarifier',
            'clarifier_reason': 'edit_clarifier_fallback',
            'clarifier_options': clarifier_options,
            'clarifier_schema_retries': schema_retries,
            'planner_schema_invalid_attempts': schema_retries,
            'planner_repair_attempted': schema_retries > 0,
            'draft_action': 'continue',
            'tool_plan': [],
            'needs_more_info': True,
            'stop_reason': resolved_stop_reason,
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
        if re.search(
            r'\b(add|create|move|delete|remove|update|mark|shift|link|unlink|rename|retitle|change|assign|reassign|unassign)\b',
            text,
        ):
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
                draft_action='continue',
                tool_plan=[],
                needs_more_info=False,
                stop_reason='ready_to_stage',
            )

        return PlanningResult(
            assistant_message=(
                'I can help with that roadmap edit. Could you confirm the exact action and target '
                '(for example: create epic, rename feature, or move task)?'
            ),
            operations=[],
            parse_mode='neutral_edit_clarifier',
            intent_type='roadmap_edit',
            response_mode='chat',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='missing_tool_call',
            clarifier_action='ask_clarifier',
            clarifier_reason='missing_tool_call',
            draft_action='continue',
            tool_plan=[],
            needs_more_info=True,
            stop_reason='awaiting_user_input',
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

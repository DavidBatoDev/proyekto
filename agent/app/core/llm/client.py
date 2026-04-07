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
from app.core.tools.registry import (
    get_edit_mode_tools,
    get_operation_tools,
    parse_plan_tool_args,
)

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
    tool_mode: Literal['none', 'context_answer', 'edit_plan', 'plan_only']
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
    llm_calls_used: int | None
    react_tool_observation_summary: list[dict[str, Any]] | None


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
    llm_calls_used: int | None = None
    react_tool_observation_summary: list[dict[str, Any]] | None = None


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
        self._history_messages_cache: dict[str, list[Any]] = {}
        self._history_messages_cache_max_entries = 128

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
        elif intent_type in {'roadmap_edit', 'confirm_action', 'roadmap_plan'}:
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
            llm_calls_used=state.get('llm_calls_used'),
            react_tool_observation_summary=state.get('react_tool_observation_summary'),
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
        routed_intent: IntentType = heuristic_intent
        if heuristic_intent in {'general_question', 'question', 'unclear'} and is_roadmap_question:
            routed_intent = 'roadmap_query'
        parse_mode = 'heuristic_prerouter'
        log_event(
            self._logger,
            'intent_classified',
            settings=self._settings,
            trace_id=trace_id,
            intent_type=routed_intent,
            is_roadmap_question=is_roadmap_question,
            parse_mode=parse_mode,
        )
        return {
            'intent_type': routed_intent,
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
        session_context = state.get('session_context', {})
        trace_id = session_context.get('trace_id')
        recent_messages_raw = session_context.get('recent_messages')
        recent_message_count = len(recent_messages_raw) if isinstance(recent_messages_raw, list) else 0
        has_edit_continuation_context = bool(state.get('force_edit_continuation')) or bool(
            state.get('existing_operations')
        )

        tool_mode: Literal['none', 'context_answer', 'edit_plan', 'plan_only']
        if intent_type == 'confirm_action' and not has_edit_continuation_context:
            mode = 'chat'
            response_mode = 'chat'
            tool_mode = 'none'
        elif intent_type in {'roadmap_edit', 'confirm_action'}:
            mode = 'edit'
            response_mode: ResponseMode = 'edit_plan'
            tool_mode = 'edit_plan'
        elif intent_type == 'roadmap_plan':
            mode = 'plan'
            response_mode = 'edit_plan'
            tool_mode = 'plan_only'
        elif intent_type == 'roadmap_query' or state.get('is_roadmap_question'):
            mode = 'query'
            response_mode = 'chat'
            tool_mode = 'context_answer'
        else:
            mode = 'chat'
            response_mode = 'chat'
            tool_mode = 'none'

        prompt_context = {
            'roadmap_id': session_context.get('roadmap_id'),
            'base_revision': session_context.get('base_revision'),
            'revision_token': session_context.get('revision_token'),
            'staged_operations_count': len(state.get('existing_operations', [])),
            'recent_message_count': recent_message_count,
            'recent_resolved_targets': session_context.get('recent_resolved_targets', []),
            'actor_context': session_context.get('actor_context'),
            'intent_type': intent_type,
            'prompt_mode': mode,
        }
        deictic_parent_hint = session_context.get('deictic_parent_hint')
        if isinstance(deictic_parent_hint, dict):
            prompt_context['deictic_parent_hint'] = deictic_parent_hint
        deictic_resolution_status = session_context.get('deictic_resolution_status')
        if isinstance(deictic_resolution_status, str) and deictic_resolution_status.strip():
            prompt_context['deictic_resolution_status'] = deictic_resolution_status.strip()
        react_loop_turn = session_context.get('_react_loop_turn')
        if react_loop_turn is not None:
            prompt_context['react_loop_turn'] = react_loop_turn
        react_loop_budget = session_context.get('_react_loop_budget')
        if react_loop_budget is not None:
            prompt_context['react_loop_budget'] = react_loop_budget
        react_loop_observation = session_context.get('_react_loop_observation')
        if react_loop_observation is not None:
            prompt_context['react_loop_observation'] = react_loop_observation
        react_tool_observation_summary = session_context.get('_react_tool_observation_summary')
        if react_tool_observation_summary is not None:
            prompt_context['react_tool_observation_summary'] = react_tool_observation_summary
        system_prompt = self._prompt_repository.build_system_prompt(mode=mode, context=prompt_context)

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
        if tool_mode in {'edit_plan', 'plan_only'}:
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
            intent_type=state.get('intent_type', 'roadmap_query'),
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
        intent_type = state.get('intent_type', 'roadmap_edit')
        existing_operations = state.get('existing_operations', [])
        system_prompt = state.get('system_prompt', '')
        session_context = state.get('session_context', {})
        history_messages = self._build_history_messages(
            session_context,
            max_messages=self._settings.max_edit_history_messages,
        )
        trace_id = session_context.get('trace_id')
        tool_definitions = (
            get_operation_tools() if intent_type == 'roadmap_plan' else get_edit_mode_tools()
        )
        total_edit_turns = max(1, int(self._settings.max_edit_tool_turns))
        react_loop_turn_raw = session_context.get('_react_loop_turn')
        react_loop_turn = 1
        if isinstance(react_loop_turn_raw, (int, float, str)):
            try:
                react_loop_turn = max(int(react_loop_turn_raw), 1)
            except (TypeError, ValueError):
                react_loop_turn = 1
        if intent_type == 'roadmap_plan':
            edit_turns = 1
        elif react_loop_turn <= 1:
            edit_turns = total_edit_turns
        else:
            # Follow-up turns should bias toward closure with existing observations.
            edit_turns = max(1, min(total_edit_turns, 3))
        max_attempts = max(1, self._settings.agent_react_max_attempts)
        max_repair_retries = max(0, self._settings.agent_react_repair_retries)
        max_attempts = min(max_attempts, max_repair_retries + 1)
        remaining_llm_budget_raw = session_context.get('_llm_calls_budget_remaining')
        remaining_llm_budget: int | None = None
        if isinstance(remaining_llm_budget_raw, (int, float, str)):
            try:
                remaining_llm_budget = max(int(remaining_llm_budget_raw), 0)
            except (TypeError, ValueError):
                remaining_llm_budget = None
        if remaining_llm_budget is not None:
            max_attempts = min(max_attempts, remaining_llm_budget)
        tool_observations: list[dict[str, Any]] = []
        tool_observation_summary: list[dict[str, Any]] = []
        llm_calls_used = 0

        def _capturing_tool_executor(name: str, args: dict[str, Any]) -> dict[str, Any]:
            result = self._execute_context_tool(name, args, session_context)
            self._record_react_tool_observation(
                observations=tool_observations,
                summary=tool_observation_summary,
                tool_name=name,
                args=args,
                result=result,
            )
            return result

        def _finalize_state(
            next_state: PlannerState,
            *,
            used_calls: int | None = None,
        ) -> PlannerState:
            next_state['react_tool_observation_summary'] = tool_observation_summary[-10:]
            effective_used = llm_calls_used if used_calls is None else used_calls
            next_state['llm_calls_used'] = max(int(effective_used or 0), 0)
            return next_state

        if max_attempts <= 0:
            return _finalize_state(
                self._neutral_edit_clarifier_state(
                    provider_error_code='llm_call_budget_exhausted',
                    schema_retries=0,
                    stop_reason='tool_budget_exhausted',
                    llm_calls_used=0,
                ),
                used_calls=0,
            )

        staged_operations_payload = json.dumps(
            [op.model_dump(exclude_none=True) for op in existing_operations],
            ensure_ascii=True,
            separators=(',', ':'),
        )
        roadmap_id_value = session_context.get('roadmap_id')
        deictic_parent_hint = (
            session_context.get('deictic_parent_hint')
            if isinstance(session_context.get('deictic_parent_hint'), dict)
            else None
        )
        prior_observation = session_context.get('_react_loop_observation')
        prior_provider_error_code = ''
        resolved_node_ids: list[str] = []
        prior_observation_tool_summary: list[dict[str, Any]] = []
        if isinstance(prior_observation, dict) and prior_observation:
            prior_provider_error_code = str(
                prior_observation.get('provider_error_code') or ''
            ).strip().lower()
            resolved_ids_raw = prior_observation.get('resolved_node_ids')
            if isinstance(resolved_ids_raw, list):
                for raw_id in resolved_ids_raw:
                    if isinstance(raw_id, str) and raw_id.strip():
                        resolved_node_ids.append(raw_id.strip())
            tool_summary_raw = prior_observation.get('tool_observation_summary')
            if isinstance(tool_summary_raw, list):
                prior_observation_tool_summary = [
                    item
                    for item in tool_summary_raw
                    if isinstance(item, dict)
                ]

        prior_tool_summary = session_context.get('_react_tool_observation_summary')
        prior_tool_summary_list: list[dict[str, Any]] = []
        if isinstance(prior_tool_summary, list):
            prior_tool_summary_list = [
                item
                for item in prior_tool_summary
                if isinstance(item, dict)
            ]
        effective_tool_summary = (
            prior_observation_tool_summary
            if prior_observation_tool_summary
            else prior_tool_summary_list
        )

        followup_closed_world_turn = (
            react_loop_turn > 1
            and prior_provider_error_code == 'max_tool_turns_exceeded'
            and bool(resolved_node_ids or effective_tool_summary)
        )
        simple_edit_profile_enabled = bool(
            self._settings.agent_simple_edit_planner_profile_enabled
        )
        simple_edit_profile = (
            simple_edit_profile_enabled
            and intent_type == 'roadmap_edit'
            and self._is_simple_edit_planner_request(user_message)
            and react_loop_turn <= 1
        )
        if followup_closed_world_turn or intent_type == 'roadmap_plan':
            tool_definitions = get_operation_tools()

        planner_profile: str | None = None
        if simple_edit_profile:
            planner_profile = 'simple_edit'
            edit_turns = min(edit_turns, 2)

        if intent_type == 'roadmap_plan':
            planner_prompt = (
                'You are in roadmap planning mode.\n'
                'Call plan_roadmap_operations exactly once.\n'
                'Generate safe roadmap structure with epic -> feature -> task hierarchy.\n'
                'Only stage operations that are valid with available IDs and parent constraints.\n'
                'If required IDs are missing, call plan_roadmap_operations with an empty operations list and place a concise structured plan in assistant_message.\n'
                'Do not call resolve_node_reference, get_children, or other discovery tools in this mode.\n\n'
                'Current staged operations:\n'
                f'{staged_operations_payload}\n\n'
                'Roadmap ID:\n'
                f'{roadmap_id_value}\n\n'
                'User request:\n'
                f'{user_message}'
            )
        elif followup_closed_world_turn:
            planner_prompt = (
                'You are in edit planning mode, follow-up ReAct turn.\n'
                f'ReAct loop turn: {react_loop_turn}.\n'
                f'Max tool calls this turn: {edit_turns}.\n'
                'ALL CONTEXT BELOW IS ALREADY RESOLVED.\n'
                'Do not call resolve_node_reference or get_children again for the same target.\n'
                'Your primary action in this turn is to call plan_roadmap_operations exactly once.\n'
                'If you still cannot produce safe operations, call plan_roadmap_operations with an empty '
                'operations list and place the clarifying question in assistant_message.\n\n'
                'Resolved node IDs:\n'
                f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}\n\n'
                'Prior tool observation summary:\n'
                f'{json.dumps(effective_tool_summary[:10], ensure_ascii=True, separators=(",", ":"))}\n\n'
                'Current staged operations:\n'
                f'{staged_operations_payload}\n\n'
                'Roadmap ID:\n'
                f'{roadmap_id_value}\n\n'
                'User request:\n'
                f'{user_message}'
            )
        elif simple_edit_profile:
            planner_prompt = (
                'You are in simple edit planning mode.\n'
                'Use context tools only if needed to resolve node IDs.\n'
                'When ready, call plan_roadmap_operations exactly once.\n'
                'Prefer the smallest safe operation set (typically update_node).\n'
                'Do not call commit or discard tools.\n'
                'Current staged operations:\n'
                f'{staged_operations_payload}\n\n'
                'Roadmap ID:\n'
                f'{roadmap_id_value}\n\n'
                'User request:\n'
                f'{user_message}'
            )
        else:
            planner_prompt = (
                'You are in edit planning mode.\n'
                'Resolve named targets to node IDs with resolve_node_reference before asking for IDs.\n'
                'Use context tools when needed to resolve node IDs and hierarchy before drafting operations.\n'
                'When ready, call plan_roadmap_operations exactly once with assistant_message and operations.\n'
                'Do not call commit or discard tools. Commit remains a UI action.\n'
                'Current staged operations:\n'
                f'{staged_operations_payload}\n\n'
                'Roadmap ID:\n'
                f'{roadmap_id_value}\n\n'
                'User request:\n'
                f'{user_message}\n\n'
                'If request is ambiguous, use context tools first, then produce the safest possible operation plan.'
            )
            if isinstance(prior_observation, dict) and prior_observation:
                planner_prompt += (
                    '\n\nPrevious ReAct observation:\n'
                    f'{json.dumps(prior_observation, ensure_ascii=True, separators=(",", ":"))}'
                )
                if prior_provider_error_code == 'max_tool_turns_exceeded':
                    planner_prompt += (
                        '\n\nPlanning retry guidance:\n'
                        'The previous planning turn reached its tool-call budget before finalizing operations. '
                        'Use the prior observations, avoid repeating resolved lookups, and call '
                        'plan_roadmap_operations as soon as the minimum safe context is available.'
                    )
                if resolved_node_ids:
                    planner_prompt += (
                        '\n\nResolved node IDs from previous turn:\n'
                        f'{json.dumps(resolved_node_ids[:20], ensure_ascii=True, separators=(",", ":"))}'
                    )
            if prior_tool_summary_list:
                planner_prompt += (
                    '\n\nPrevious tool observation summary:\n'
                    f'{json.dumps(prior_tool_summary_list[:5], ensure_ascii=True, separators=(",", ":"))}'
                )
            if remaining_llm_budget is not None:
                planner_prompt += (
                    '\n\nRemaining planner call budget for this turn:\n'
                    f'{remaining_llm_budget}'
                )
            if react_loop_turn > 1:
                planner_prompt += (
                    '\n\nFollow-up planning turn guidance:\n'
                    f'This is ReAct loop turn {react_loop_turn}. '
                    f'You have at most {edit_turns} tool calls this turn. '
                    'Prefer previously resolved context and call plan_roadmap_operations '
                    'as soon as a safe operation plan can be staged.'
                )
        schema_invalid_attempts = 0
        repair_attempted = False
        last_provider_error_code: str | None = None
        planner_prompt_bytes = len(planner_prompt.encode('utf-8'))
        history_messages_count = len(history_messages)

        def _invoke_plan_with_tools(adapter: Any) -> tuple[str, list[RoadmapOperation]]:
            if planner_profile:
                try:
                    return adapter.plan_operations_with_tools(
                        system_prompt=system_prompt,
                        planner_prompt=planner_prompt,
                        history_messages=history_messages,
                        tools=tool_definitions,
                        tool_executor=_capturing_tool_executor,
                        max_tool_turns=edit_turns,
                        planner_profile=planner_profile,
                    )
                except TypeError:
                    # Backward compatibility for test doubles and legacy adapters
                    pass
            return adapter.plan_operations_with_tools(
                system_prompt=system_prompt,
                planner_prompt=planner_prompt,
                history_messages=history_messages,
                tools=tool_definitions,
                tool_executor=_capturing_tool_executor,
                max_tool_turns=edit_turns,
            )

        for attempt in range(max_attempts):
            if attempt > 0:
                repair_attempted = True
            try:
                llm_calls_used += 1
                result = self._provider_orchestrator.call(
                    _invoke_plan_with_tools,
                    trace_context={
                        'trace_id': trace_id,
                        'phase': 'edit_plan',
                        'planner_profile': planner_profile or 'default',
                        'planner_prompt_bytes': planner_prompt_bytes,
                        'history_messages_count': history_messages_count,
                    },
                )
            except ProviderAdapterError as exc:
                last_provider_error_code = exc.code
                if exc.code == 'max_tool_turns_exceeded':
                    provider_used: ProviderUsed = (
                        'openai'
                        if str(exc.provider).strip().lower() == 'openai'
                        else 'rule_based'
                    )
                    self._logger.warning(
                        'Edit tool-call budget exhausted; returning replanning observation. code=%s message=%s',
                        exc.code,
                        exc.message,
                    )
                    return _finalize_state(
                        {
                            'assistant_message': (
                                'Collected partial context and will continue edit planning in the next turn.'
                            ),
                            'planned_operations': [],
                            'response_mode': 'edit_plan',
                            'preview_recommended': False,
                            'parse_mode': 'deterministic_react_tool_budget_replan',
                            'provider_used': provider_used,
                            'fallback_used': False,
                            'provider_error_code': exc.code,
                            'tokens_input': exc.tokens_input,
                            'tokens_output': exc.tokens_output,
                            'tokens_total': exc.tokens_total,
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
                            'needs_more_info': True,
                            'stop_reason': 'tool_budget_exhausted',
                            'llm_calls_used': llm_calls_used,
                        },
                        used_calls=llm_calls_used,
                    )
                if exc.code in {'invalid_operation_payload', 'missing_tool_call'} and attempt + 1 < max_attempts:
                    schema_invalid_attempts += 1
                    repair_attempted = True
                    planner_prompt = self._augment_repair_planner_prompt(
                        planner_prompt=planner_prompt,
                        error_code=exc.code,
                    )
                    if exc.code == 'missing_tool_call':
                        # Retry in planning-only mode to avoid rediscovery churn.
                        tool_definitions = get_operation_tools()
                        planner_prompt = self._augment_missing_tool_call_retry_prompt(
                            planner_prompt=planner_prompt,
                            user_message=user_message,
                            tool_observations=tool_observations,
                        )
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
                    return _finalize_state(
                        self._build_synthesized_react_closure_state(
                            operations=synthesized_operations,
                            schema_invalid_attempts=schema_invalid_attempts,
                            repair_attempted=repair_attempted,
                            draft_action='continue',
                            tool_plan=[],
                        )
                    )
                clarifier_state = self._build_edit_clarifier_state(
                    user_message=user_message,
                    system_prompt=system_prompt,
                    history_messages=history_messages,
                    trace_id=trace_id,
                    provider_error_code=exc.code,
                    llm_calls_used_base=llm_calls_used,
                )
                return _finalize_state(
                    clarifier_state,
                    used_calls=clarifier_state.get('llm_calls_used'),
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
                (
                    operations,
                    parent_hint_applied,
                    parent_uuid_violations,
                ) = self._coerce_parent_hint_for_operations(
                    operations=operations,
                    deictic_parent_hint=deictic_parent_hint,
                )
                if parent_uuid_violations:
                    if attempt + 1 < max_attempts:
                        schema_invalid_attempts += 1
                        repair_attempted = True
                        planner_prompt = self._augment_parent_uuid_retry_prompt(
                            planner_prompt=planner_prompt,
                            parent_uuid_violations=parent_uuid_violations,
                            deictic_parent_hint=deictic_parent_hint,
                        )
                        continue

                    required_parent_types = sorted(
                        {
                            str(item.get('required_parent_type') or '').strip()
                            for item in parent_uuid_violations
                            if str(item.get('required_parent_type') or '').strip()
                        }
                    )
                    if required_parent_types:
                        target_text = ' or '.join(required_parent_types)
                        question = (
                            'I need the exact parent node before I can safely stage this edit. '
                            f'Please provide the parent {target_text} label or node ID.'
                        )
                    else:
                        question = (
                            'I need the exact parent node before I can safely stage this edit. '
                            'Please provide the parent label or node ID.'
                        )
                    clarifier_message, clarifier_options = build_clarifier_contract(
                        reason='invalid_parent_uuid_unresolved',
                        question=question,
                        options=['Provide parent label', 'Provide parent node ID', 'Cancel'],
                    )
                    return _finalize_state(
                        {
                            'assistant_message': clarifier_message,
                            'planned_operations': [],
                            'response_mode': 'chat',
                            'preview_recommended': False,
                            'parse_mode': 'deterministic_react_parent_uuid_clarifier',
                            'provider_used': 'rule_based',
                            'fallback_used': True,
                            'provider_error_code': 'invalid_parent_uuid_unresolved',
                            'tokens_input': result.tokens_input,
                            'tokens_output': result.tokens_output,
                            'tokens_total': result.tokens_total,
                            'pending_context_resolution': None,
                            'clear_pending_context_resolution': False,
                            'clarifier_action': 'ask_clarifier',
                            'clarifier_reason': 'invalid_parent_uuid_unresolved',
                            'clarifier_options': clarifier_options,
                            'clarifier_schema_retries': schema_invalid_attempts,
                            'planner_schema_invalid_attempts': schema_invalid_attempts,
                            'planner_repair_attempted': repair_attempted,
                            'draft_action': 'continue',
                            'tool_plan': [],
                            'needs_more_info': True,
                            'stop_reason': 'awaiting_user_input',
                        }
                    )

                log_event(
                    self._logger,
                    'plan_generated',
                    settings=self._settings,
                    trace_id=trace_id,
                    provider_used=result.provider_used,
                    fallback_used=result.fallback_used,
                    operations_count=len(operations),
                    operation_types=[op.op.value for op in operations],
                    parent_hint_applied=parent_hint_applied,
                    planner_prompt_bytes=planner_prompt_bytes,
                    history_messages_count=history_messages_count,
                    tokens_input=result.tokens_input,
                    tokens_output=result.tokens_output,
                    tokens_total=result.tokens_total,
                )
                return _finalize_state(
                    {
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
                )

            synthesized_operations = self._maybe_synthesize_react_closure_operations(
                user_message=user_message,
                tool_observations=tool_observations,
            )
            if synthesized_operations:
                return _finalize_state(
                    self._build_synthesized_react_closure_state(
                        operations=synthesized_operations,
                        schema_invalid_attempts=schema_invalid_attempts,
                        repair_attempted=repair_attempted,
                        draft_action='continue',
                        tool_plan=[],
                        tokens_input=result.tokens_input,
                        tokens_output=result.tokens_output,
                        tokens_total=result.tokens_total,
                    )
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
            return _finalize_state(
                {
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
            )

        synthesized_operations = self._maybe_synthesize_react_closure_operations(
            user_message=user_message,
            tool_observations=tool_observations,
        )
        if synthesized_operations:
            return _finalize_state(
                self._build_synthesized_react_closure_state(
                    operations=synthesized_operations,
                    schema_invalid_attempts=schema_invalid_attempts,
                    repair_attempted=repair_attempted,
                    draft_action='continue',
                    tool_plan=[],
                )
            )

        return _finalize_state(
            self._neutral_edit_clarifier_state(
                provider_error_code=last_provider_error_code or 'invalid_planner_schema',
                schema_retries=schema_invalid_attempts,
                llm_calls_used=llm_calls_used,
            )
        )

    def _summarize_react_tool_observations(
        self,
        observations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        summary: list[dict[str, Any]] = []
        for observation in observations[-10:]:
            if not isinstance(observation, dict):
                continue
            summary_item = self._summarize_react_tool_observation(
                tool_name=str(observation.get('tool_name') or ''),
                args=observation.get('args'),
                result=observation.get('result'),
            )
            if summary_item is not None:
                summary.append(summary_item)
        return summary

    def _record_react_tool_observation(
        self,
        *,
        observations: list[dict[str, Any]],
        summary: list[dict[str, Any]],
        tool_name: str,
        args: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        observation = {
            'tool_name': tool_name,
            'args': dict(args) if isinstance(args, dict) else {},
            'result': result,
        }
        observations.append(observation)
        summary_item = self._summarize_react_tool_observation(
            tool_name=tool_name,
            args=observation.get('args'),
            result=result,
        )
        if summary_item is not None:
            summary.append(summary_item)
        if len(summary) > 10:
            del summary[: len(summary) - 10]

    def _summarize_react_tool_observation(
        self,
        *,
        tool_name: str,
        args: Any,
        result: Any,
    ) -> dict[str, Any] | None:
        normalized_tool_name = str(tool_name or '').strip()
        if not normalized_tool_name:
            return None
        summary_item: dict[str, Any] = {'tool_name': normalized_tool_name}

        if isinstance(args, dict):
            summary_item['arg_keys'] = sorted(str(key) for key in args.keys())[:6]
            label = args.get('label')
            if isinstance(label, str) and label.strip():
                summary_item['label'] = label.strip()[:80]
            node_id_arg = args.get('node_id')
            if isinstance(node_id_arg, str) and node_id_arg.strip():
                summary_item['queried_node_id'] = node_id_arg.strip()

        if isinstance(result, dict):
            status = result.get('status')
            if isinstance(status, str) and status.strip():
                summary_item['status'] = status.strip()[:48]
            error_payload = result.get('error')
            if isinstance(error_payload, dict):
                error_code = error_payload.get('code')
                if error_code is not None:
                    summary_item['error_code'] = str(error_code)[:80]
            selected = result.get('selected')
            if isinstance(selected, dict):
                selected_id = selected.get('id')
                if isinstance(selected_id, str) and selected_id.strip():
                    summary_item['selected_id'] = selected_id.strip()
            node_id = result.get('id')
            if isinstance(node_id, str) and node_id.strip():
                summary_item['node_id'] = node_id.strip()
            node_type = result.get('type')
            if isinstance(node_type, str) and node_type.strip():
                summary_item['node_type'] = node_type.strip()[:32]
            node_status = result.get('status') or result.get('state')
            if isinstance(node_status, str) and node_status.strip():
                summary_item['node_status'] = node_status.strip()[:48]
            node_title = result.get('title')
            if isinstance(node_title, str) and node_title.strip():
                summary_item['node_title'] = node_title.strip()[:80]
            matches = result.get('matches')
            if isinstance(matches, list):
                summary_item['match_count'] = len(matches)
                match_ids: list[str] = []
                match_items: list[dict[str, str]] = []
                for match in matches[:5]:
                    if isinstance(match, dict):
                        match_id = match.get('id')
                        if isinstance(match_id, str) and match_id.strip():
                            normalized_match_id = match_id.strip()
                            match_ids.append(normalized_match_id)
                            match_items.append(
                                {
                                    'id': normalized_match_id,
                                    'title': str(match.get('title') or '').strip()[:60],
                                    'type': str(
                                        match.get('type') or match.get('node_type') or ''
                                    ).strip()[:24],
                                    'status': str(
                                        match.get('status') or match.get('state') or ''
                                    ).strip()[:24],
                                }
                            )
                if match_ids:
                    summary_item['match_ids'] = match_ids
                if match_items:
                    summary_item['match_items'] = match_items
            children = result.get('children')
            if isinstance(children, list):
                summary_item['children_count'] = len(children)
                child_ids: list[str] = []
                child_statuses: dict[str, str] = {}
                child_items: list[dict[str, str]] = []
                for child in children[:20]:
                    if not isinstance(child, dict):
                        continue
                    child_id = child.get('id')
                    if not isinstance(child_id, str) or not child_id.strip():
                        continue
                    normalized_child_id = child_id.strip()
                    child_ids.append(normalized_child_id)
                    child_status = child.get('status') or child.get('state')
                    if isinstance(child_status, str) and child_status.strip():
                        child_statuses[normalized_child_id] = child_status.strip()[:48]
                    child_items.append(
                        {
                            'id': normalized_child_id,
                            'title': str(child.get('title') or '').strip()[:60],
                            'type': str(
                                child.get('type') or child.get('node_type') or ''
                            ).strip()[:24],
                            'status': str(child_status or '').strip()[:24],
                        }
                    )
                if child_ids:
                    summary_item['child_ids'] = child_ids
                if child_statuses:
                    summary_item['child_statuses'] = child_statuses
                if child_items:
                    summary_item['children'] = child_items

        return summary_item

    def _is_uuid(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        return bool(
            re.fullmatch(
                r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
                value.strip(),
            )
        )

    def _coerce_parent_hint_for_operations(
        self,
        *,
        operations: list[RoadmapOperation],
        deictic_parent_hint: dict[str, Any] | None,
    ) -> tuple[list[RoadmapOperation], bool, list[dict[str, Any]]]:
        hint_node_id = ''
        hint_node_type = ''
        if isinstance(deictic_parent_hint, dict):
            hint_node_id = str(deictic_parent_hint.get('node_id') or '').strip()
            hint_node_type = str(deictic_parent_hint.get('node_type') or '').strip().lower()
        if not self._is_uuid(hint_node_id):
            hint_node_id = ''
            hint_node_type = ''

        corrected_operations: list[RoadmapOperation] = []
        parent_hint_applied = False
        violations: list[dict[str, Any]] = []

        for index, operation in enumerate(operations):
            op_name = operation.op.value if hasattr(operation.op, 'value') else str(operation.op)
            required_parent_type = None
            if op_name == 'add_feature':
                required_parent_type = 'epic'
            elif op_name == 'add_task':
                required_parent_type = 'feature'

            if required_parent_type is None:
                corrected_operations.append(operation)
                continue

            if self._is_uuid(operation.parent_id):
                corrected_operations.append(operation)
                continue

            if hint_node_id and (hint_node_type == required_parent_type):
                corrected_operation = operation.model_copy(deep=True)
                corrected_operation.parent_id = hint_node_id
                corrected_operations.append(corrected_operation)
                parent_hint_applied = True
                continue

            corrected_operations.append(operation)
            violations.append(
                {
                    'index': index,
                    'operation': op_name,
                    'required_parent_type': required_parent_type,
                    'parent_id': operation.parent_id,
                }
            )

        return corrected_operations, parent_hint_applied, violations

    def _augment_parent_uuid_retry_prompt(
        self,
        *,
        planner_prompt: str,
        parent_uuid_violations: list[dict[str, Any]],
        deictic_parent_hint: dict[str, Any] | None,
    ) -> str:
        violation_payload = json.dumps(
            parent_uuid_violations[:5],
            ensure_ascii=True,
            separators=(',', ':'),
        )
        hint_payload = (
            json.dumps(deictic_parent_hint, ensure_ascii=True, separators=(',', ':'))
            if isinstance(deictic_parent_hint, dict)
            else 'null'
        )
        return (
            f'{planner_prompt}\n\n'
            'PARENT UUID CONTRACT REPAIR:\n'
            'One or more add_feature/add_task operations used a parent_id that is not a valid UUID.\n'
            'Retry by calling plan_roadmap_operations exactly once and ensure every add_feature/add_task '
            'operation has a valid UUID parent_id.\n'
            'If parent UUID is still unknown, return empty operations and ask one focused clarifier.\n\n'
            f'Parent UUID violations:\n{violation_payload}\n\n'
            f'Deictic parent hint (if available):\n{hint_payload}'
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

    @staticmethod
    def _augment_repair_planner_prompt(
        *,
        planner_prompt: str,
        error_code: str,
    ) -> str:
        if error_code == 'missing_tool_call':
            guidance = (
                '\n\nIMPORTANT REPAIR: Your previous response did not call '
                'plan_roadmap_operations. You MUST call plan_roadmap_operations exactly once. '
                'If clarification is still needed, return an empty operations list in that tool call '
                'and ask the clarifying question in assistant_message.'
            )
        elif error_code == 'invalid_operation_payload':
            guidance = (
                '\n\nIMPORTANT REPAIR: Your previous tool-call payload failed schema validation. '
                'Retry with a valid plan_roadmap_operations payload using only supported operation fields.'
            )
        else:
            return planner_prompt

        if guidance.strip() in planner_prompt:
            return planner_prompt
        return planner_prompt + guidance

    def _augment_missing_tool_call_retry_prompt(
        self,
        *,
        planner_prompt: str,
        user_message: str,
        tool_observations: list[dict[str, Any]],
    ) -> str:
        if not tool_observations:
            return planner_prompt

        updated_prompt = planner_prompt
        summary_marker = 'RETRY TOOL OBSERVATION SUMMARY:'
        if summary_marker not in updated_prompt:
            retry_summary = self._summarize_react_tool_observations(tool_observations)
            if retry_summary:
                updated_prompt += (
                    '\n\nRETRY TOOL OBSERVATION SUMMARY:\n'
                    f'{json.dumps(retry_summary[:10], ensure_ascii=True, separators=(",", ":"))}'
                )

        requested_count = self._extract_todo_delete_count(user_message)
        if requested_count is None:
            return updated_prompt

        ordered_todo_candidates = self._collect_ordered_todo_delete_candidates(tool_observations)
        if len(ordered_todo_candidates) < requested_count:
            return updated_prompt

        policy_marker = 'DETERMINISTIC TODO DELETE SELECTION POLICY:'
        if policy_marker in updated_prompt:
            return updated_prompt

        updated_prompt += (
            '\n\nDETERMINISTIC TODO DELETE SELECTION POLICY:\n'
            f'User requested removing {requested_count} todo tasks.\n'
            'Use ONLY the ordered candidate list below.\n'
            f'Select the first {requested_count} candidates in listed order where status is exactly "todo".\n'
            'Then call plan_roadmap_operations exactly once with delete_node operations for those IDs.\n'
            'Do not ask which tasks to delete when this deterministic candidate list is available.\n'
            'Ordered todo task candidates:\n'
            f'{json.dumps(ordered_todo_candidates[:20], ensure_ascii=True, separators=(",", ":"))}'
        )
        return updated_prompt

    @staticmethod
    def _extract_todo_delete_count(user_message: str) -> int | None:
        text = ' '.join(user_message.strip().lower().split())
        if not text:
            return None

        digit_match = re.search(
            r'\b(?:remove|delete)\s+(\d+)\s+(?:\w+\s+)?todo\s+tasks?\b',
            text,
        )
        if digit_match is not None:
            requested_count = int(digit_match.group(1))
            return requested_count if requested_count > 0 else None

        word_to_number = {
            'one': 1,
            'two': 2,
            'three': 3,
            'four': 4,
            'five': 5,
            'six': 6,
            'seven': 7,
            'eight': 8,
            'nine': 9,
            'ten': 10,
        }
        word_match = re.search(
            r'\b(?:remove|delete)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?todo\s+tasks?\b',
            text,
        )
        if word_match is None:
            return None

        return word_to_number.get(word_match.group(1))

    @staticmethod
    def _collect_ordered_todo_delete_candidates(
        tool_observations: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        candidates: list[dict[str, str]] = []
        seen_ids: set[str] = set()

        for observation in tool_observations:
            if str(observation.get('tool_name') or '').strip() != 'get_children':
                continue

            result = observation.get('result')
            if not isinstance(result, dict):
                continue

            children = result.get('children')
            if not isinstance(children, list):
                continue

            for child in children:
                if not isinstance(child, dict):
                    continue

                node_id = str(child.get('id') or '').strip()
                if not node_id or node_id in seen_ids:
                    continue

                node_type = str(child.get('type') or child.get('node_type') or '').strip().lower()
                if node_type and node_type != 'task':
                    continue

                status = str(child.get('status') or child.get('state') or '').strip().lower()
                if status != 'todo':
                    continue

                seen_ids.add(node_id)
                candidates.append(
                    {
                        'id': node_id,
                        'title': str(child.get('title') or '').strip()[:80],
                        'type': node_type or 'task',
                        'status': status,
                    }
                )

        return candidates

    def _build_edit_clarifier_state(
        self,
        *,
        user_message: str,
        system_prompt: str,
        history_messages: list[Any],
        trace_id: str | None,
        provider_error_code: str,
        llm_calls_used_base: int = 0,
    ) -> PlannerState:
        clarification_prompt = self._build_edit_clarifier_prompt(user_message=user_message)
        schema_retries = 0
        parse_error_code: str | None = None
        stop_reason = map_provider_error_to_stop_reason(provider_error_code)
        llm_calls_used = max(int(llm_calls_used_base), 0)

        for attempt in range(2):
            try:
                llm_calls_used += 1
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
                    llm_calls_used=llm_calls_used,
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
                    'llm_calls_used': llm_calls_used,
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
            llm_calls_used=llm_calls_used,
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
        llm_calls_used: int | None = None,
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
            'llm_calls_used': max(int(llm_calls_used or 0), 0),
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

    def _build_history_messages(
        self,
        session_context: dict[str, Any],
        *,
        max_messages: int | None = None,
    ) -> list[Any]:
        if AIMessage is None or HumanMessage is None:
            return []

        history = session_context.get('recent_messages', [])
        if max_messages is None:
            history_limit = self._settings.max_chat_history_messages
        else:
            try:
                history_limit = max(int(max_messages), 0)
            except (TypeError, ValueError):
                history_limit = self._settings.max_chat_history_messages
        if history_limit <= 0:
            return []

        history_slice = history[-history_limit:]
        cache = getattr(self, '_history_messages_cache', None)
        if not isinstance(cache, dict):
            cache = {}
            setattr(self, '_history_messages_cache', cache)
        cache_max_entries = getattr(self, '_history_messages_cache_max_entries', 128)
        if not isinstance(cache_max_entries, int) or cache_max_entries <= 0:
            cache_max_entries = 128
            setattr(self, '_history_messages_cache_max_entries', cache_max_entries)

        cache_key = self._history_messages_cache_key(
            history_slice=history_slice,
            history_limit=history_limit,
        )
        cached_messages = cache.get(cache_key)
        if cached_messages is not None:
            return list(cached_messages)

        messages: list[Any] = []
        for item in history_slice:
            if not isinstance(item, dict):
                continue
            role = str(item.get('role', '')).strip().lower()
            content = str(item.get('content', '')).strip()
            if not content:
                continue
            if role == 'assistant':
                messages.append(AIMessage(content=content))
            elif role == 'user':
                messages.append(HumanMessage(content=content))

        cache[cache_key] = list(messages)
        while len(cache) > cache_max_entries:
            oldest_key = next(iter(cache), None)
            if oldest_key is None:
                break
            cache.pop(oldest_key, None)
        return messages

    def _history_messages_cache_key(
        self,
        *,
        history_slice: list[Any],
        history_limit: int,
    ) -> str:
        normalized_items: list[dict[str, str]] = []
        for item in history_slice:
            if not isinstance(item, dict):
                continue
            role = str(item.get('role', '')).strip().lower()
            content = str(item.get('content', '')).strip()
            if not content:
                continue
            normalized_items.append({'role': role, 'content': content})
        serialized = json.dumps(normalized_items, ensure_ascii=True, separators=(',', ':'))
        digest = hashlib.sha1(serialized.encode('utf-8')).hexdigest()[:20]
        return f'{history_limit}:{digest}:{len(normalized_items)}'

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
        if self._looks_like_confirm_action(text):
            return 'confirm_action'
        if self._looks_like_roadmap_plan_request(text):
            return 'roadmap_plan'
        if re.search(
            r'\b(add|create|move|delete|remove|update|mark|shift|link|unlink|rename|retitle|change|assign|reassign|unassign)\b',
            text,
        ):
            return 'roadmap_edit'
        if text.endswith('?') or re.search(r'^(what|why|how|when|where|can you|could you|do we)\b', text):
            return 'general_question'
        if re.search(r'\b(list|show|tell(?:\s+me)?)\b.*\b(roadmap|epic|feature|task|milestone)\b', text):
            return 'general_question'
        return 'unclear'

    def _looks_like_confirm_action(self, normalized_text: str) -> bool:
        return bool(
            re.fullmatch(
                r"(?:"
                r"(?:ok|okay|yes|yep)(?:\s+(?:please|kindly))?(?:\s+(?:confirm|proceed|go ahead|do it|apply))?"
                r"|(?:confirm|proceed|go ahead|do it|let'?s do it|apply(?: those)? changes?)"
                r")"
                r"(?:\s+(?:please|kindly|now))?"
                r"(?:\s+(?:with\s+)?(?:this|it|that))?"
                r"(?:\s+(?:please|kindly|now))?",
                normalized_text,
            )
        )

    def _looks_like_roadmap_plan_request(self, normalized_text: str) -> bool:
        return bool(
            re.search(
                r'\b(?:'
                r'(?:create|build|draft|design)\s+(?:a\s+)?roadmap'
                r'|roadmap\s+for'
                r'|plan\s+(?:a\s+)?roadmap'
                r'|break\s+(?:this|that|it)\s+into'
                r'|suggest\s+(?:tasks?|features?|epics?)'
                r'|propose\s+(?:tasks?|features?|epics?)'
                r'|structure\s+(?:this|that|it)'
                r')\b',
                normalized_text,
            )
        )

    def _is_simple_edit_planner_request(self, user_message: str) -> bool:
        normalized = ' '.join(str(user_message or '').strip().lower().split())
        if not normalized:
            return False
        if self._looks_like_roadmap_plan_request(normalized):
            return False
        if re.search(r'\b(add|create|delete|remove|move|shift|plan|roadmap)\b', normalized):
            return False
        return bool(
            re.search(
                r'\b(rename|retitle|change\s+name|update\s+(?:the\s+)?(?:title|name))\b',
                normalized,
            )
        )

    def _is_roadmap_question(
        self,
        *,
        intent_type: IntentType,
        user_message: str,
        session_context: dict[str, Any],
    ) -> bool:
        if not session_context.get('roadmap_id'):
            return False
        if intent_type in {'roadmap_edit', 'roadmap_plan', 'confirm_action'}:
            return False
        if intent_type == 'roadmap_query':
            return True
        lowered = user_message.strip().lower()
        roadmap_keywords = (
            'roadmap',
            'epic',
            'feature',
            'task',
            'overdue',
            'assigned',
            'assignee',
            'status',
            'timeline',
            'dependency',
            'milestone',
        )
        if any(keyword in lowered for keyword in roadmap_keywords):
            return True
        return intent_type in {'general_question', 'question', 'unclear'}

    def _rule_based_chat_response(self, user_message: str, intent_type: IntentType) -> str:
        lowered = user_message.strip().lower()
        if intent_type == 'smalltalk':
            return 'Hi. I can chat normally and help you prepare roadmap edits when you are ready.'
        if intent_type in {'general_question', 'question'}:
            return (
                'I can help explain roadmap structure, suggest planning steps, and prepare safe edit operations '
                'that you can preview manually.'
            )
        if intent_type == 'roadmap_query':
            return 'I can answer roadmap data questions using read-only context tools. Ask about epics, features, tasks, or statuses.'
        if intent_type == 'roadmap_plan':
            return 'I can draft a roadmap plan with epic, feature, and task structure. Share your objective and constraints.'
        if intent_type == 'confirm_action':
            return 'I can apply confirmations when there is a pending plan. If you want to execute changes, confirm the exact draft or target.'
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

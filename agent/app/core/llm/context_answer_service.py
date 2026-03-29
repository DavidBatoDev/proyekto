from __future__ import annotations

import logging
import json
from dataclasses import dataclass
from typing import Any, Callable

from app.core.config import Settings
from app.core.contracts.sessions import IntentType
from app.core.logging_utils import log_event
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import get_context_tools

from .deterministic_context import (
    ContextResolutionOutcome,
    is_rich_my_tasks_request,
    try_deterministic_list_answer,
    try_pending_context_selection,
)
from .deterministic_intents import (
    DeterministicContextIntent,
    match_deterministic_context_intent,
    match_global_overview_intent,
    should_include_ids,
)
from .providers import ProviderAdapterError, ProviderOrchestrator

ToolExecutor = Callable[[str, dict[str, Any], dict[str, Any]], dict[str, Any]]
CacheKeyBuilder = Callable[..., str]
ChatFallbackBuilder = Callable[[str, IntentType], str]


@dataclass
class _DiscoveryGuardState:
    calls_used: int = 0
    repeat_hits: int = 0
    stop_reason: str | None = None
    clarifier_returned: bool = False
    clarifier_template_id: str | None = None


class ContextAnswerService:
    def __init__(
        self,
        *,
        settings: Settings,
        logger: logging.Logger,
        provider_orchestrator: ProviderOrchestrator,
        context_answer_cache: ContextAnswerCache,
        execute_context_tool: ToolExecutor,
        build_context_cache_key: CacheKeyBuilder,
        chat_fallback_builder: ChatFallbackBuilder,
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._provider_orchestrator = provider_orchestrator
        self._context_answer_cache = context_answer_cache
        self._execute_context_tool = execute_context_tool
        self._build_context_cache_key = build_context_cache_key
        self._chat_fallback_builder = chat_fallback_builder

    def generate(
        self,
        *,
        user_message: str,
        system_prompt: str,
        session_context: dict[str, Any],
        history_messages: list[Any],
        intent_type: IntentType,
    ) -> dict[str, Any]:
        trace_id = session_context.get('trace_id')
        context_tools = get_context_tools()
        fallback_response = self._chat_fallback_builder(user_message, intent_type)
        cache_key = self._build_context_cache_key(
            roadmap_id=str(session_context.get('roadmap_id') or ''),
            user_message=user_message,
            roadmap_updated_token=(
                session_context.get('revision_token')
                or session_context.get('base_revision')
            ),
            actor_id=(
                str(session_context.get('actor_context', {}).get('actor_id') or '').strip()
                if isinstance(session_context.get('actor_context'), dict)
                else None
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
            return self._build_cached_response(cached_answer)
        log_event(
            self._logger,
            'cache_miss',
            settings=self._settings,
            trace_id=trace_id,
            cache_scope='context_answer',
            roadmap_id=session_context.get('roadmap_id'),
        )
        global_overview_match = match_global_overview_intent(user_message)
        if global_overview_match is not None:
            overview_intent, overview_label = global_overview_match
            deterministic_outcome = self._try_deterministic_list_answer(
                intent=overview_intent,
                label=overview_label,
                include_ids=should_include_ids(user_message),
                user_message=user_message,
                session_context=session_context,
                trace_id=trace_id,
            )
            if deterministic_outcome is not None:
                response = {
                    'assistant_message': deterministic_outcome.answer,
                    'planned_operations': [],
                    'response_mode': 'chat',
                    'preview_recommended': False,
                    'parse_mode': overview_intent.parse_mode,
                    'provider_used': 'rule_based',
                    'fallback_used': False,
                    'provider_error_code': None,
                    'pending_context_resolution': deterministic_outcome.pending_context_resolution,
                    'clear_pending_context_resolution': True,
                    'route_lane': 'deterministic_fastpath',
                    'discovery_calls_used': 0,
                    'discovery_repeat_hits': 0,
                    'discovery_stop_reason': 'resolved',
                    'clarifier_returned': False,
                    'discovery_contract': self._build_discovery_contract(
                        capability='roadmap_overview',
                        resolved_targets=[],
                        status_scope=None,
                        needs_clarification=False,
                        clarifier_prompt=None,
                    ),
                }
                self._cache_response_if_safe(cache_key, response)
                return response

        pending_selection_outcome = self._try_pending_context_selection(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
        )
        if pending_selection_outcome is not None:
            return {
                'assistant_message': pending_selection_outcome.answer,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'deterministic_context_resolution_selection',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': None,
                'pending_context_resolution': pending_selection_outcome.pending_context_resolution,
                'clear_pending_context_resolution': pending_selection_outcome.clear_pending_context_resolution,
                'route_lane': 'deterministic_fastpath',
                'discovery_calls_used': 0,
                'discovery_repeat_hits': 0,
                'discovery_stop_reason': 'resolved',
                'clarifier_returned': False,
                'discovery_contract': self._build_discovery_contract(
                    capability='pending_selection',
                    resolved_targets=[],
                    status_scope=None,
                    needs_clarification=False,
                    clarifier_prompt=None,
                ),
            }

        deterministic_match = match_deterministic_context_intent(user_message)
        if deterministic_match is not None:
            intent, label = deterministic_match
            deterministic_outcome = self._try_deterministic_list_answer(
                intent=intent,
                label=label,
                include_ids=should_include_ids(user_message),
                user_message=user_message,
                session_context=session_context,
                trace_id=trace_id,
            )
            if deterministic_outcome is not None:
                my_tasks_response = self._maybe_synthesize_my_tasks_response(
                    intent=intent,
                    deterministic_outcome=deterministic_outcome,
                    user_message=user_message,
                    system_prompt=system_prompt,
                    session_context=session_context,
                )
                if my_tasks_response is not None:
                    self._cache_response_if_safe(cache_key, my_tasks_response)
                    return my_tasks_response
                response = {
                    'assistant_message': deterministic_outcome.answer,
                    'planned_operations': [],
                    'response_mode': 'chat',
                    'preview_recommended': False,
                    'parse_mode': intent.parse_mode,
                    'provider_used': 'rule_based',
                    'fallback_used': False,
                    'provider_error_code': None,
                    'pending_context_resolution': deterministic_outcome.pending_context_resolution,
                    'clear_pending_context_resolution': deterministic_outcome.clear_pending_context_resolution,
                    'route_lane': 'deterministic_fastpath',
                    'discovery_calls_used': 0,
                    'discovery_repeat_hits': 0,
                    'discovery_stop_reason': 'resolved',
                    'clarifier_returned': False,
                    'discovery_contract': self._build_discovery_contract(
                        capability=intent.pending_kind,
                        resolved_targets=[],
                        status_scope=None,
                        needs_clarification=False,
                        clarifier_prompt=None,
                    ),
                }
                self._cache_response_if_safe(cache_key, response)
                return response

        # Discovery lane is fixed-budget: provider loop turns should not exceed
        # the configured discovery call budget.
        context_turns = max(1, int(self._settings.max_discovery_tool_calls))
        discovery_guard, discovery_state = self._build_discovery_guard(
            session_context=session_context,
            trace_id=trace_id,
        )
        question_prompt = (
            'Answer the user question about the roadmap.\n'
            'Use available context tools when the answer depends on roadmap data.\n'
            'Prefer get_children_from_resolution over raw id chaining after resolve_node_reference.\n'
            'Use get_features for feature-list questions under a resolved epic.\n'
            'Use get_tasks_assigned_to_me when the user asks for tasks assigned to them.\n'
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
                    tool_executor=discovery_guard,
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
                discovery_calls_used=discovery_state.calls_used,
                discovery_repeat_hits=discovery_state.repeat_hits,
                discovery_stop_reason='resolved',
                clarifier_returned=False,
            )
            response = {
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
                'route_lane': 'discovery_lane',
                'discovery_calls_used': discovery_state.calls_used,
                'discovery_repeat_hits': discovery_state.repeat_hits,
                'discovery_stop_reason': 'resolved',
                'clarifier_returned': False,
                'discovery_contract': self._build_discovery_contract(
                    capability='context_answer',
                    resolved_targets=[],
                    status_scope=None,
                    needs_clarification=False,
                    clarifier_prompt=None,
                ),
            }
            self._context_answer_cache.set(cache_key, self._cache_payload(response))
            return response
        except ProviderAdapterError as exc:
            if exc.code in {
                'discovery_budget_exhausted',
                'discovery_repeat_limit_exhausted',
            }:
                parse_mode = (
                    'deterministic_context_repeat_limit_exhausted'
                    if exc.code == 'discovery_repeat_limit_exhausted'
                    else 'deterministic_context_budget_exhausted'
                )
                return {
                    'assistant_message': exc.message,
                    'planned_operations': [],
                    'response_mode': 'chat',
                    'preview_recommended': False,
                    'parse_mode': parse_mode,
                    'provider_used': 'rule_based',
                    'fallback_used': False,
                    'provider_error_code': exc.code,
                    'discovery_calls_used': discovery_state.calls_used,
                    'discovery_repeat_hits': discovery_state.repeat_hits,
                    'discovery_stop_reason': discovery_state.stop_reason,
                    'clarifier_returned': True,
                    'route_lane': 'discovery_lane',
                    'discovery_contract': self._build_discovery_contract(
                        capability='context_answer',
                        resolved_targets=[],
                        status_scope=None,
                        needs_clarification=True,
                        clarifier_prompt=exc.message,
                    ),
                }
            self._logger.warning(
                'Provider context answer failed, using chat fallback. code=%s message=%s',
                exc.code,
                exc.message,
            )
            log_event(
                self._logger,
                'context_discovery_summary',
                settings=self._settings,
                trace_id=trace_id,
                discovery_calls_used=discovery_state.calls_used,
                discovery_repeat_hits=discovery_state.repeat_hits,
                discovery_stop_reason='tool_error',
                clarifier_returned=False,
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
                'route_lane': 'discovery_lane',
                'discovery_calls_used': discovery_state.calls_used,
                'discovery_repeat_hits': discovery_state.repeat_hits,
                'discovery_stop_reason': 'tool_error',
                'clarifier_returned': False,
                'discovery_contract': self._build_discovery_contract(
                    capability='context_answer',
                    resolved_targets=[],
                    status_scope=None,
                    needs_clarification=False,
                    clarifier_prompt=None,
                ),
            }

    def _maybe_synthesize_my_tasks_response(
        self,
        *,
        intent: DeterministicContextIntent,
        deterministic_outcome: ContextResolutionOutcome,
        user_message: str,
        system_prompt: str,
        session_context: dict[str, Any],
    ) -> dict[str, Any] | None:
        if intent.pending_kind != 'my_tasks':
            return None

        trace_id = session_context.get('trace_id')
        telemetry = dict(deterministic_outcome.telemetry or {})
        should_synthesize = bool(
            deterministic_outcome.synthesis_payload
            and is_rich_my_tasks_request(user_message)
        )
        synthesis_attempted = False
        synthesis_used = False
        synthesis_fallback = False
        provider_error_code: str | None = None
        provider_used: str = 'rule_based'
        fallback_used = False
        parse_mode = intent.parse_mode
        answer = deterministic_outcome.answer
        tokens_input: int | None = None
        tokens_output: int | None = None
        tokens_total: int | None = None

        if should_synthesize:
            synthesis_attempted = True
            synthesis_result = self._synthesize_my_tasks_answer(
                system_prompt=system_prompt,
                user_message=user_message,
                deterministic_payload=deterministic_outcome.synthesis_payload or {},
                trace_id=trace_id,
            )
            if synthesis_result is not None:
                synthesis_used = True
                answer = str(synthesis_result.value or '').strip() or answer
                parse_mode = f'{intent.parse_mode}_synthesized'
                provider_used = synthesis_result.provider_used
                fallback_used = synthesis_result.fallback_used
                provider_error_code = synthesis_result.provider_error_code
                tokens_input = synthesis_result.tokens_input
                tokens_output = synthesis_result.tokens_output
                tokens_total = synthesis_result.tokens_total
            else:
                synthesis_fallback = True

        log_event(
            self._logger,
            'my_tasks_synthesis_state',
            settings=self._settings,
            trace_id=trace_id,
            parse_mode=intent.parse_mode,
            my_tasks_synthesis_attempted=synthesis_attempted,
            my_tasks_synthesis_used=synthesis_used,
            my_tasks_synthesis_fallback=synthesis_fallback,
            actor_present=telemetry.get('actor_present'),
            roadmap_role=telemetry.get('roadmap_role'),
            actor_context_source=telemetry.get('actor_context_source'),
            task_count=telemetry.get('task_count'),
            status_filter=telemetry.get('status_filter'),
        )

        return {
            'assistant_message': answer,
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': parse_mode,
            'provider_used': provider_used,
            'fallback_used': fallback_used,
            'provider_error_code': provider_error_code,
            'pending_context_resolution': deterministic_outcome.pending_context_resolution,
            'clear_pending_context_resolution': deterministic_outcome.clear_pending_context_resolution,
            'tokens_input': tokens_input,
            'tokens_output': tokens_output,
            'tokens_total': tokens_total,
            'route_lane': 'deterministic_fastpath',
            'discovery_calls_used': 0,
            'discovery_repeat_hits': 0,
            'discovery_stop_reason': 'resolved',
            'clarifier_returned': False,
            'discovery_contract': self._build_discovery_contract(
                capability='my_tasks',
                resolved_targets=[],
                status_scope=None,
                needs_clarification=False,
                clarifier_prompt=None,
            ),
        }

    def _synthesize_my_tasks_answer(
        self,
        *,
        system_prompt: str,
        user_message: str,
        deterministic_payload: dict[str, Any],
        trace_id: str | None,
    ) -> Any | None:
        synthesis_system_prompt = (
            f'{system_prompt}\n\n'
            'You are formatting a deterministic, pre-authorized task list.\n'
            'Rules:\n'
            '- Do not infer identity, permissions, or missing tasks.\n'
            '- Do not call tools.\n'
            '- Do not mention internal system details.\n'
            '- Keep output concise and faithful to provided task data.'
        )
        synthesis_user_prompt = (
            'Rewrite the deterministic task result to match the user request style.\n'
            f'User request: {user_message}\n'
            f'Deterministic task payload: {json.dumps(deterministic_payload, ensure_ascii=True)}'
        )
        try:
            return self._provider_orchestrator.call(
                lambda adapter: adapter.generate_chat_reply(
                    system_prompt=synthesis_system_prompt,
                    user_message=synthesis_user_prompt,
                    history_messages=[],
                ),
                trace_context={'trace_id': trace_id, 'phase': 'my_tasks_synthesis'},
            )
        except ProviderAdapterError as exc:
            self._logger.warning(
                'My-tasks synthesis failed, using deterministic response. code=%s message=%s',
                exc.code,
                exc.message,
            )
            return None
        except Exception as exc:  # pragma: no cover
            self._logger.warning(
                'My-tasks synthesis failed with unexpected error, using deterministic response. error=%s',
                exc,
            )
            return None

    def _build_discovery_guard(
        self,
        *,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> tuple[Callable[[str, dict[str, Any]], dict[str, Any]], _DiscoveryGuardState]:
        discovery_state = _DiscoveryGuardState()
        signature_counts: dict[str, int] = {}

        def _guarded_execute(
            tool_name: str,
            args: dict[str, Any],
        ) -> dict[str, Any]:
            max_calls = max(1, int(self._settings.max_discovery_tool_calls))
            max_repeat = max(1, int(self._settings.max_repeated_tool_calls_per_signature))
            signature = self._tool_signature(tool_name, args)
            signature_count = signature_counts.get(signature, 0)

            if signature_count >= max_repeat:
                discovery_state.repeat_hits += 1
                discovery_state.stop_reason = 'repeat_limit_exhausted'
                discovery_state.clarifier_returned = True
                discovery_state.clarifier_template_id = 'context_clarifier_repeat_v1'
                clarifier = (
                    'I kept hitting the same lookup path and want to avoid looping. '
                    'Can you narrow this to one specific epic, feature, or status filter?'
                )
                log_event(
                    self._logger,
                    'context_discovery_stopped',
                    settings=self._settings,
                    trace_id=trace_id,
                    discovery_calls_used=discovery_state.calls_used,
                    discovery_repeat_hits=discovery_state.repeat_hits,
                    discovery_stop_reason=discovery_state.stop_reason,
                    clarifier_returned=True,
                    clarifier_template_id=discovery_state.clarifier_template_id,
                )
                raise ProviderAdapterError(
                    provider='orchestrator',
                    code='discovery_repeat_limit_exhausted',
                    message=clarifier,
                )

            if discovery_state.calls_used >= max_calls:
                discovery_state.stop_reason = 'budget_exhausted'
                discovery_state.clarifier_returned = True
                discovery_state.clarifier_template_id = 'context_clarifier_budget_v1'
                clarifier = (
                    'I reached the discovery limit for this turn. '
                    'Do you want me to focus on one epic/feature or one assignee/status filter?'
                )
                log_event(
                    self._logger,
                    'context_discovery_stopped',
                    settings=self._settings,
                    trace_id=trace_id,
                    discovery_calls_used=discovery_state.calls_used,
                    discovery_repeat_hits=discovery_state.repeat_hits,
                    discovery_stop_reason=discovery_state.stop_reason,
                    clarifier_returned=True,
                    clarifier_template_id=discovery_state.clarifier_template_id,
                )
                raise ProviderAdapterError(
                    provider='orchestrator',
                    code='discovery_budget_exhausted',
                    message=clarifier,
                )

            signature_counts[signature] = signature_count + 1
            discovery_state.calls_used += 1
            return self._execute_context_tool(tool_name, args, session_context)

        return _guarded_execute, discovery_state

    @staticmethod
    def _tool_signature(tool_name: str, args: dict[str, Any]) -> str:
        normalized_args = json.dumps(
            args,
            ensure_ascii=True,
            sort_keys=True,
            separators=(',', ':'),
            default=str,
        )
        return f'{tool_name}:{normalized_args}'

    @staticmethod
    def _build_discovery_contract(
        *,
        capability: str,
        resolved_targets: list[dict[str, Any]],
        status_scope: str | None,
        needs_clarification: bool,
        clarifier_prompt: str | None,
    ) -> dict[str, Any]:
        return {
            'capability': capability,
            'resolved_targets': resolved_targets,
            'status_scope': status_scope,
            'needs_clarification': needs_clarification,
            'clarifier_prompt': clarifier_prompt,
        }

    def _try_pending_context_selection(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return try_pending_context_selection(
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            execute_context_tool=self._execute_context_tool,
        )

    def _try_deterministic_list_answer(
        self,
        *,
        intent: DeterministicContextIntent,
        label: str,
        include_ids: bool,
        user_message: str | None,
        session_context: dict[str, Any],
        trace_id: str | None,
    ) -> ContextResolutionOutcome | None:
        return try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=include_ids,
            user_message=user_message,
            session_context=session_context,
            trace_id=trace_id,
            logger=self._logger,
            settings=self._settings,
            execute_context_tool=self._execute_context_tool,
        )

    def _build_cached_response(self, cached_value: dict[str, Any] | str) -> dict[str, Any]:
        if isinstance(cached_value, str):
            return {
                'assistant_message': cached_value,
                'planned_operations': [],
                'response_mode': 'chat',
                'preview_recommended': False,
                'parse_mode': 'context_cache_hit',
                'provider_used': 'rule_based',
                'fallback_used': False,
                'provider_error_code': None,
                'route_lane': 'deterministic_fastpath',
                'discovery_calls_used': 0,
                'discovery_repeat_hits': 0,
                'discovery_stop_reason': 'resolved',
                'clarifier_returned': False,
                'discovery_contract': self._build_discovery_contract(
                    capability='context_cache_hit',
                    resolved_targets=[],
                    status_scope=None,
                    needs_clarification=False,
                    clarifier_prompt=None,
                ),
            }

        response = {
            'assistant_message': str(cached_value.get('assistant_message') or ''),
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': str(cached_value.get('parse_mode') or 'context_cache_hit'),
            'provider_used': str(cached_value.get('provider_used') or 'rule_based'),
            'fallback_used': bool(cached_value.get('fallback_used', False)),
            'provider_error_code': cached_value.get('provider_error_code'),
            'pending_context_resolution': cached_value.get('pending_context_resolution'),
            'clear_pending_context_resolution': bool(
                cached_value.get('clear_pending_context_resolution', False)
            ),
            'tokens_input': cached_value.get('tokens_input'),
            'tokens_output': cached_value.get('tokens_output'),
            'tokens_total': cached_value.get('tokens_total'),
            'route_lane': str(cached_value.get('route_lane') or 'deterministic_fastpath'),
            'discovery_calls_used': int(cached_value.get('discovery_calls_used') or 0),
            'discovery_repeat_hits': int(cached_value.get('discovery_repeat_hits') or 0),
            'discovery_stop_reason': cached_value.get('discovery_stop_reason'),
            'clarifier_returned': bool(cached_value.get('clarifier_returned', False)),
            'discovery_contract': (
                cached_value.get('discovery_contract')
                if isinstance(cached_value.get('discovery_contract'), dict)
                else self._build_discovery_contract(
                    capability='context_cache_hit',
                    resolved_targets=[],
                    status_scope=None,
                    needs_clarification=False,
                    clarifier_prompt=None,
                )
            ),
        }
        return response

    def _cache_response_if_safe(self, key: str, response: dict[str, Any]) -> None:
        pending = response.get('pending_context_resolution')
        if pending:
            return
        if not bool(response.get('clear_pending_context_resolution', False)):
            return
        self._context_answer_cache.set(key, self._cache_payload(response))

    def _cache_payload(self, response: dict[str, Any]) -> dict[str, Any]:
        return {
            'assistant_message': response.get('assistant_message'),
            'parse_mode': response.get('parse_mode'),
            'provider_used': response.get('provider_used'),
            'fallback_used': response.get('fallback_used', False),
            'provider_error_code': response.get('provider_error_code'),
            'pending_context_resolution': response.get('pending_context_resolution'),
            'clear_pending_context_resolution': response.get('clear_pending_context_resolution', False),
            'tokens_input': response.get('tokens_input'),
            'tokens_output': response.get('tokens_output'),
            'tokens_total': response.get('tokens_total'),
            'route_lane': response.get('route_lane'),
            'discovery_calls_used': response.get('discovery_calls_used'),
            'discovery_repeat_hits': response.get('discovery_repeat_hits'),
            'discovery_stop_reason': response.get('discovery_stop_reason'),
            'clarifier_returned': response.get('clarifier_returned'),
            'discovery_contract': response.get('discovery_contract'),
        }

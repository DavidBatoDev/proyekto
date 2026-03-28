from __future__ import annotations

import logging
from typing import Any, Callable

from app.core.config import Settings
from app.core.contracts.sessions import IntentType
from app.core.logging_utils import log_event
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import get_context_tools

from .deterministic_context import (
    ContextResolutionOutcome,
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
                }
                self._cache_response_if_safe(cache_key, response)
                return response

        context_turns = min(self._settings.max_context_tool_turns, 4)
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
                    tool_executor=lambda name, args: self._execute_context_tool(
                        name,
                        args,
                        session_context,
                    ),
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
            }
            self._context_answer_cache.set(cache_key, self._cache_payload(response))
            return response
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
        }

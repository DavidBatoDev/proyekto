from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Literal, TypedDict

from pydantic import BaseModel

from app.core.config import get_settings
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import IntentType, ProviderUsed, ResponseMode
from app.core.llm.context.context_answer_service import ContextAnswerService
from app.core.llm.context.context_tools_executor import ContextToolsExecutor
from app.core.llm.planning import planner_execution_flow
from app.core.llm.planning import planner_history_utils
from app.core.llm.planning import planner_intent_classifier
from app.core.llm.planning import planner_react_helpers
from app.core.llm.planning import planner_rule_fallback
from app.core.llm.planning.planner_operation_flow import plan_operations as plan_operations_helper
from app.core.llm.providers import (
    IntentClassificationResult,
    ProviderAdapterError,
    ProviderOrchestrator,
)
from app.core.nest_client import NestRoadmapClient
from app.core.prompts import PromptRepository
from app.core.response_cache import ContextAnswerCache
from app.core.tools.registry import reset_active_handle_map, set_active_handle_map

try:
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover
    AIMessage = None  # type: ignore[assignment]
    HumanMessage = None  # type: ignore[assignment]
    ToolMessage = None  # type: ignore[assignment]
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
    clarifier_question: str | None
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
    plan_proposal_payload: dict[str, Any] | None
    clarifier_question: str | None
    # Raw tool-observation list from the edit-lane react loop, surfaced
    # through PlannerState so the orchestrator can snapshot it onto
    # `pending_edit_context.prior_tool_observations` for next-turn replay.
    tool_observations: list[dict[str, Any]] | None
    classifier_sub_intent: Literal[
        'rename_only',
        'delete_only',
        'status_change_only',
        'move_only',
    ] | None
    classifier_source: Literal['llm', 'heuristic_fallback'] | None
    classifier_model: str | None
    classifier_fallback_reason: str | None
    classifier_rationale: str | None
    classifier_elapsed_ms: int | None


_CLASSIFIER_TRANSLATIONS: dict[str, IntentType] = {
    'question': 'general_question',
}


def _heuristic_classifier_payload(
    *,
    user_message: str,
    fallback_reason: str,
) -> dict[str, Any]:
    intent = planner_intent_classifier.heuristic_intent(user_message)
    return {
        'intent_type': intent,
        'sub_intent': None,
        'rationale': '',
        'model': None,
        'source': 'heuristic_fallback',
        'fallback_reason': fallback_reason,
        'tokens_input': None,
        'tokens_output': None,
        'tokens_total': None,
        'tokens_cached': None,
        'elapsed_ms': 0,
    }


def _normalize_classifier_intent(intent: IntentType) -> IntentType:
    """Collapse the `question` alias to `general_question`.

    The prompt template still lists `question` as a legal value for
    backwards compatibility with older callers, but the live routing logic
    (`_route_from_intent`, `_is_roadmap_question`) treats the two
    interchangeably. Normalizing here keeps the rest of the pipeline on a
    single canonical value.
    """
    return _CLASSIFIER_TRANSLATIONS.get(intent, intent)


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
    clarifier_question: str | None = None
    clarifier_schema_retries: int | None = None
    planner_schema_invalid_attempts: int | None = None
    planner_repair_attempted: bool | None = None
    draft_action: str | None = None
    tool_plan: list[dict[str, Any]] | None = None
    needs_more_info: bool | None = None
    stop_reason: str | None = None
    llm_calls_used: int | None = None
    react_tool_observation_summary: list[dict[str, Any]] | None = None
    plan_proposal_payload: dict[str, Any] | None = None
    tool_observations: list[dict[str, Any]] | None = None


class LLMPlanner:
    def __init__(self) -> None:
        self._logger = logging.getLogger(__name__)
        self._settings = get_settings()
        self._edit_clarifier_payload_model = _EditClarifierPayload
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
        payload = self._classify_intent_llm_first(
            user_message=user_message,
            session_context=session_context,
        )
        intent = payload['intent_type']
        if session_context is not None:
            session_context['_classifier_result'] = payload
        is_roadmap_question = self._is_roadmap_question(
            intent_type=intent,
            user_message=user_message,
            session_context=session_context or {},
        )
        return intent, is_roadmap_question

    def _classify_intent_llm_first(
        self,
        *,
        user_message: str,
        session_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        trace_id: Any = None
        if isinstance(session_context, dict):
            trace_id = session_context.get('trace_id')

        if not self._settings.agent_llm_intent_classifier_enabled:
            return _heuristic_classifier_payload(
                user_message=user_message,
                fallback_reason='feature_flag_disabled',
            )

        is_available_fn = getattr(self._provider_orchestrator, 'is_available', None)
        if callable(is_available_fn):
            try:
                provider_available = bool(is_available_fn())
            except Exception:
                provider_available = False
        else:
            provider_available = False
        if not provider_available:
            return _heuristic_classifier_payload(
                user_message=user_message,
                fallback_reason='provider_unavailable',
            )

        classifier_prompt = self._prompt_repository.intent_classifier_prompt()
        if not classifier_prompt.strip():
            return _heuristic_classifier_payload(
                user_message=user_message,
                fallback_reason='classifier_prompt_missing',
            )

        started = perf_counter()
        try:
            outcome = self._provider_orchestrator.call(
                lambda adapter: adapter.classify_intent(
                    classifier_prompt=classifier_prompt,
                    classifier_input=user_message,
                ),
                trace_context={'trace_id': trace_id, 'phase': 'intent_classifier'},
            )
        except ProviderAdapterError as exc:
            elapsed_ms = int((perf_counter() - started) * 1000)
            self._logger.info(
                'LLM intent classifier failed; falling back to heuristic. code=%s',
                exc.code,
            )
            payload = _heuristic_classifier_payload(
                user_message=user_message,
                fallback_reason=f'provider_error:{exc.code}',
            )
            payload['elapsed_ms'] = elapsed_ms
            return payload

        elapsed_ms = int((perf_counter() - started) * 1000)
        classification: IntentClassificationResult = outcome.value
        normalized_intent = _normalize_classifier_intent(classification.intent_type)
        return {
            'intent_type': normalized_intent,
            'sub_intent': classification.sub_intent,
            'bulk_scope': getattr(classification, 'bulk_scope', 'none'),
            'rationale': classification.rationale,
            'model': classification.model,
            'source': 'llm',
            'fallback_reason': None,
            'tokens_input': outcome.tokens_input,
            'tokens_output': outcome.tokens_output,
            'tokens_total': outcome.tokens_total,
            'tokens_cached': None,
            'elapsed_ms': elapsed_ms,
        }

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
        graph.add_node('generate_plan_proposal', self._generate_plan_proposal)
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
                'generate_plan_proposal': 'generate_plan_proposal',
                'plan_operations': 'plan_operations',
            },
        )
        graph.add_edge('generate_chat_reply', 'persist_session_state')
        graph.add_edge('generate_context_answer', 'persist_session_state')
        graph.add_edge('generate_plan_proposal', 'persist_session_state')
        graph.add_edge('plan_operations', 'persist_session_state')
        graph.add_edge('persist_session_state', END)
        return graph.compile()

    def _plan_with_langgraph(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
        session_context: dict[str, Any],
    ) -> PlanningResult | None:
        return planner_execution_flow.plan_with_langgraph(
            self,
            user_message=user_message,
            existing_operations=existing_operations,
            session_context=session_context,
            planning_result_cls=PlanningResult,
        )

    def _classify_intent(self, state: PlannerState) -> PlannerState:
        return planner_execution_flow.classify_intent(self, state)

    def _compose_dynamic_system_prompt(self, state: PlannerState) -> PlannerState:
        return planner_execution_flow.compose_dynamic_system_prompt(self, state)

    def _route_from_intent(self, state: PlannerState) -> str:
        return planner_execution_flow.route_from_intent(state)

    def _generate_chat_reply(self, state: PlannerState) -> PlannerState:
        return planner_execution_flow.generate_chat_reply(self, state)

    def _generate_context_answer(self, state: PlannerState) -> PlannerState:
        return planner_execution_flow.generate_context_answer(self, state)

    def _generate_plan_proposal(self, state: PlannerState) -> PlannerState:
        return planner_execution_flow.generate_plan_proposal(self, state)

    def _get_context_answer_service(self) -> ContextAnswerService:
        return planner_execution_flow.get_context_answer_service(self)

    def _plan_operations(self, state: PlannerState) -> PlannerState:
        session_context = state.get('session_context') or {}
        handle_map_raw = session_context.get('roadmap_handle_map')
        handle_map = (
            handle_map_raw
            if isinstance(handle_map_raw, dict) and handle_map_raw
            else None
        )
        token = set_active_handle_map(handle_map)
        try:
            return plan_operations_helper(self, state)
        finally:
            reset_active_handle_map(token)

    def _summarize_react_tool_observations(
        self,
        observations: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return planner_react_helpers.summarize_react_tool_observations(self, observations)

    def _record_react_tool_observation(
        self,
        *,
        observations: list[dict[str, Any]],
        summary: list[dict[str, Any]],
        tool_name: str,
        args: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        planner_react_helpers.record_react_tool_observation(
            self,
            observations=observations,
            summary=summary,
            tool_name=tool_name,
            args=args,
            result=result,
        )

    def _summarize_react_tool_observation(
        self,
        *,
        tool_name: str,
        args: Any,
        result: Any,
    ) -> dict[str, Any] | None:
        return planner_react_helpers.summarize_react_tool_observation(
            tool_name=tool_name,
            args=args,
            result=result,
        )

    def _is_uuid(self, value: Any) -> bool:
        return planner_react_helpers.is_uuid(value)

    def _coerce_parent_hint_for_operations(
        self,
        *,
        operations: list[RoadmapOperation],
        deictic_parent_hint: dict[str, Any] | None,
    ) -> tuple[list[RoadmapOperation], bool, list[dict[str, Any]]]:
        return planner_react_helpers.coerce_parent_hint_for_operations(
            self,
            operations=operations,
            deictic_parent_hint=deictic_parent_hint,
        )

    def _augment_parent_uuid_retry_prompt(
        self,
        *,
        planner_prompt: str,
        parent_uuid_violations: list[dict[str, Any]],
        deictic_parent_hint: dict[str, Any] | None,
    ) -> str:
        return planner_react_helpers.augment_parent_uuid_retry_prompt(
            planner_prompt=planner_prompt,
            parent_uuid_violations=parent_uuid_violations,
            deictic_parent_hint=deictic_parent_hint,
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
        return planner_react_helpers.build_synthesized_react_closure_state(
            operations=operations,
            schema_invalid_attempts=schema_invalid_attempts,
            repair_attempted=repair_attempted,
            draft_action=draft_action,
            tool_plan=tool_plan,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            tokens_total=tokens_total,
        )

    def _maybe_synthesize_react_closure_operations(
        self,
        *,
        user_message: str,
        tool_observations: list[dict[str, Any]],
        session_context: dict[str, Any] | None = None,
        force_include_completed: bool | None = None,
    ) -> list[RoadmapOperation] | None:
        return planner_react_helpers.maybe_synthesize_react_closure_operations(
            self,
            user_message=user_message,
            tool_observations=tool_observations,
            session_context=session_context,
            force_include_completed=force_include_completed,
        )

    def _extract_rename_request_labels(self, user_message: str) -> tuple[str, str] | None:
        return planner_react_helpers.extract_rename_request_labels(user_message)

    @staticmethod
    def _strip_quotes_and_punctuation(value: str) -> str:
        return planner_react_helpers.strip_quotes_and_punctuation(value)

    @staticmethod
    def _normalize_label_for_matching(value: str) -> str:
        return planner_react_helpers.normalize_label_for_matching(value)

    def _augment_repair_planner_prompt(
        self,
        *,
        planner_prompt: str,
        error_code: str,
        error_message: str | None = None,
        raw_tool_args: Any = None,
        tool_observations: list[dict[str, Any]] | None = None,
    ) -> str:
        return planner_react_helpers.augment_repair_planner_prompt(
            planner_prompt=planner_prompt,
            error_code=error_code,
            error_message=error_message,
            raw_tool_args=raw_tool_args,
            tool_observations=tool_observations,
            planner=self,
        )

    @staticmethod
    def _is_invalid_operation_enum_payload(error_message: str | None) -> bool:
        return planner_react_helpers.is_invalid_operation_enum_payload(error_message)

    def _augment_missing_tool_call_retry_prompt(
        self,
        *,
        planner_prompt: str,
        user_message: str,
        tool_observations: list[dict[str, Any]],
    ) -> str:
        return planner_react_helpers.augment_missing_tool_call_retry_prompt(
            self,
            planner_prompt=planner_prompt,
            user_message=user_message,
            tool_observations=tool_observations,
        )

    @staticmethod
    def _extract_todo_delete_count(user_message: str) -> int | None:
        return planner_react_helpers.extract_todo_delete_count(user_message)

    @staticmethod
    def _collect_ordered_todo_delete_candidates(
        tool_observations: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        return planner_react_helpers.collect_ordered_todo_delete_candidates(tool_observations)

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
        return planner_react_helpers.build_edit_clarifier_state(
            self,
            user_message=user_message,
            system_prompt=system_prompt,
            history_messages=history_messages,
            trace_id=trace_id,
            provider_error_code=provider_error_code,
            llm_calls_used_base=llm_calls_used_base,
        )

    def _build_edit_clarifier_prompt(self, *, user_message: str) -> str:
        return planner_react_helpers.build_edit_clarifier_prompt(user_message=user_message)

    def _parse_edit_clarifier_payload(self, raw: str) -> _EditClarifierPayload:
        payload_model = getattr(self, '_edit_clarifier_payload_model', None)
        if payload_model is None:
            payload_model = _EditClarifierPayload
            self._edit_clarifier_payload_model = payload_model
        return planner_react_helpers.parse_edit_clarifier_payload(
            raw,
            payload_model=payload_model,
        )

    def _format_edit_clarifier_message(self, payload: _EditClarifierPayload) -> tuple[str, list[str]]:
        return planner_react_helpers.format_edit_clarifier_message(payload)

    def _neutral_edit_clarifier_state(
        self,
        *,
        provider_error_code: str | None,
        schema_retries: int,
        stop_reason: str | None = None,
        llm_calls_used: int | None = None,
    ) -> PlannerState:
        return planner_react_helpers.neutral_edit_clarifier_state(
            provider_error_code=provider_error_code,
            schema_retries=schema_retries,
            stop_reason=stop_reason,
            llm_calls_used=llm_calls_used,
        )

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

    def _execute_context_tools_parallel(
        self,
        calls: list[tuple[str, dict[str, Any]]],
        session_context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return self._get_context_tools_executor().execute_many(
            calls=calls,
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
        return planner_history_utils.build_history_messages(
            self,
            session_context=session_context,
            max_messages=max_messages,
            ai_message_cls=AIMessage,
            human_message_cls=HumanMessage,
            tool_message_cls=ToolMessage,
        )

    def _history_messages_cache_key(
        self,
        *,
        history_slice: list[Any],
        history_limit: int,
    ) -> str:
        return planner_history_utils.history_messages_cache_key(
            history_slice=history_slice,
            history_limit=history_limit,
        )

    def _heuristic_intent(self, user_message: str) -> IntentType:
        return planner_intent_classifier.heuristic_intent(user_message)

    def _looks_like_confirm_action(self, normalized_text: str) -> bool:
        return planner_intent_classifier.looks_like_confirm_action(normalized_text)

    def _looks_like_roadmap_plan_request(self, normalized_text: str) -> bool:
        return planner_intent_classifier.looks_like_roadmap_plan_request(normalized_text)

    def _is_roadmap_question(
        self,
        *,
        intent_type: IntentType,
        user_message: str,
        session_context: dict[str, Any],
    ) -> bool:
        return planner_intent_classifier.is_roadmap_question(
            intent_type=intent_type,
            user_message=user_message,
            session_context=session_context,
        )

    def _is_question_style_edit_request(self, user_message: str) -> bool:
        return planner_intent_classifier.is_question_style_edit_request(user_message)

    def _is_informational_operation_question(self, user_message: str) -> bool:
        return planner_intent_classifier.is_informational_operation_question(user_message)

    def _rule_based_chat_response(self, user_message: str, intent_type: IntentType) -> str:
        return planner_rule_fallback.rule_based_chat_response(user_message, intent_type)

    def _rule_based_operation_plan(self, user_message: str) -> PlanningResult:
        return planner_rule_fallback.rule_based_operation_plan(
            user_message=user_message,
            planning_result_cls=PlanningResult,
        )

    def _plan_with_rules(
        self,
        user_message: str,
        existing_operations: list[RoadmapOperation],
    ) -> PlanningResult:
        return planner_rule_fallback.plan_with_rules(
            user_message=user_message,
            existing_operations=existing_operations,
            planning_result_cls=PlanningResult,
            heuristic_intent_resolver=self._heuristic_intent,
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

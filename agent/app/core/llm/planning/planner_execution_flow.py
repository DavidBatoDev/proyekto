from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from app.core.llm.context.context_answer_service import ContextAnswerService
from app.core.llm.outage import build_outage_clarifier_message
from app.core.llm.providers import ProviderAdapterError
from app.core.llm.react.react_executor import map_provider_error_to_stop_reason
from app.core.logging_utils import log_event
from app.core.tools.registry import get_context_tools


def plan_with_langgraph(
    planner: Any,
    *,
    user_message: str,
    existing_operations: list[Any],
    session_context: dict[str, Any],
    planning_result_cls: type[Any],
) -> Any | None:
    try:
        state: dict[str, Any] = planner._langgraph.invoke(  # type: ignore[call-arg]
            {
                'user_message': user_message,
                'existing_operations': existing_operations,
                'session_context': session_context,
            }
        )
    except Exception as exc:  # pragma: no cover
        planner._logger.exception('LangGraph invocation failed: %s', exc)
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
    elif response_mode == 'plan_proposal':
        if draft_action is None:
            draft_action = 'none'
        if tool_plan is None:
            tool_plan = []
        if needs_more_info is None:
            needs_more_info = False
        if stop_reason is None:
            stop_reason = 'plan_ready_for_confirmation'
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

    return planning_result_cls(
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
        clear_pending_context_resolution=bool(
            state.get('clear_pending_context_resolution', False)
        ),
        clarifier_action=state.get('clarifier_action'),
        clarifier_reason=state.get('clarifier_reason'),
        clarifier_options=state.get('clarifier_options'),
        clarifier_question=state.get('clarifier_question'),
        clarifier_schema_retries=state.get('clarifier_schema_retries'),
        planner_schema_invalid_attempts=state.get('planner_schema_invalid_attempts'),
        planner_repair_attempted=state.get('planner_repair_attempted'),
        draft_action=draft_action,
        tool_plan=tool_plan,
        needs_more_info=needs_more_info,
        stop_reason=stop_reason,
        llm_calls_used=state.get('llm_calls_used'),
        react_tool_observation_summary=state.get('react_tool_observation_summary'),
        plan_proposal_payload=state.get('plan_proposal_payload'),
        tool_observations=state.get('tool_observations'),
    )


def classify_intent(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    session_context = state.get('session_context', {})
    trace_id = session_context.get('trace_id')
    force_edit_continuation = bool(session_context.get('force_edit_continuation'))
    force_reason = str(session_context.get('force_edit_continuation_reason') or '').strip() or None
    if force_edit_continuation:
        parse_mode = 'deterministic_edit_continuation_override'
        log_event(
            planner._logger,
            'intent_classified',
            settings=planner._settings,
            trace_id=trace_id,
            intent_type='roadmap_edit',
            is_roadmap_question=False,
            parse_mode=parse_mode,
            classifier_source=None,
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
            'classifier_sub_intent': None,
            'classifier_source': None,
            'classifier_model': None,
            'classifier_fallback_reason': None,
            'classifier_rationale': None,
            'classifier_elapsed_ms': None,
        }

    cached = session_context.get('_classifier_result')
    if isinstance(cached, dict) and cached.get('intent_type'):
        classifier_payload = cached
    else:
        classifier_payload = planner._classify_intent_llm_first(
            user_message=user_message,
            session_context=session_context,
        )
        session_context['_classifier_result'] = classifier_payload

    classifier_intent = classifier_payload.get('intent_type', 'unclear')
    classifier_sub_intent = classifier_payload.get('sub_intent')
    classifier_source = classifier_payload.get('source')
    classifier_model = classifier_payload.get('model')
    classifier_rationale = classifier_payload.get('rationale') or None
    classifier_fallback_reason = classifier_payload.get('fallback_reason')
    classifier_elapsed_ms = classifier_payload.get('elapsed_ms')

    question_style_edit_promoted = False
    is_roadmap_question = planner._is_roadmap_question(
        intent_type=classifier_intent,
        user_message=user_message,
        session_context=session_context,
    )
    routed_intent = classifier_intent
    if (
        classifier_intent in {'general_question', 'question', 'unclear'}
        and planner._is_question_style_edit_request(user_message)
    ):
        routed_intent = 'roadmap_edit'
        question_style_edit_promoted = True
        is_roadmap_question = False
    if classifier_intent in {'general_question', 'question', 'unclear'} and is_roadmap_question:
        routed_intent = 'roadmap_query'

    if routed_intent != 'roadmap_edit':
        classifier_sub_intent = None

    if question_style_edit_promoted:
        parse_mode = 'heuristic_question_style_edit_override'
    elif classifier_source == 'llm':
        parse_mode = 'llm_classifier'
    else:
        parse_mode = 'heuristic_prerouter'

    log_event(
        planner._logger,
        'intent_classified',
        settings=planner._settings,
        trace_id=trace_id,
        intent_type=routed_intent,
        is_roadmap_question=is_roadmap_question,
        parse_mode=parse_mode,
        question_style_edit_promoted=question_style_edit_promoted,
        classifier_source=classifier_source,
        classifier_model=classifier_model,
        classifier_sub_intent=classifier_sub_intent,
        classifier_fallback_reason=classifier_fallback_reason,
        classifier_elapsed_ms=classifier_elapsed_ms,
        classifier_tokens_input=classifier_payload.get('tokens_input'),
        classifier_tokens_output=classifier_payload.get('tokens_output'),
    )
    return {
        'intent_type': routed_intent,
        'parse_mode': parse_mode,
        'provider_used': 'rule_based',
        'fallback_used': False,
        'provider_error_code': None,
        'is_roadmap_question': is_roadmap_question,
        'question_style_edit_promoted': question_style_edit_promoted,
        'classifier_sub_intent': classifier_sub_intent,
        'classifier_source': classifier_source,
        'classifier_model': classifier_model,
        'classifier_fallback_reason': classifier_fallback_reason,
        'classifier_rationale': classifier_rationale,
        'classifier_elapsed_ms': classifier_elapsed_ms,
    }


def compose_dynamic_system_prompt(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
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
    confirm_without_context = intent_type == 'confirm_action' and not has_edit_continuation_context
    edit_to_clarifier_guarded = False

    if confirm_without_context:
        mode = 'chat'
        response_mode = 'chat'
        tool_mode = 'none'
    elif intent_type in {'roadmap_edit', 'confirm_action'}:
        mode = 'edit'
        response_mode = 'edit_plan'
        tool_mode = 'edit_plan'
    elif intent_type == 'roadmap_plan':
        mode = 'plan'
        tool_mode = 'plan_only'
        plan_proposal_flag = bool(
            getattr(planner._settings, 'agent_plan_proposal_enabled', False)
        )
        response_mode = 'plan_proposal' if plan_proposal_flag else 'edit_plan'
    elif intent_type == 'roadmap_query' or state.get('is_roadmap_question'):
        mode = 'query'
        response_mode = 'chat'
        tool_mode = 'context_answer'
    else:
        mode = 'chat'
        response_mode = 'chat'
        tool_mode = 'none'

    if session_context.get('_actor_fetch_future') is not None:
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            resolve_deferred_actor_context,
        )
        resolve_deferred_actor_context(session_context)
    if session_context.get('_roadmap_overview_fetch_future') is not None:
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            resolve_deferred_roadmap_overview_summary,
        )
        resolve_deferred_roadmap_overview_summary(session_context)
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
        'roadmap_overview_summary': session_context.get('roadmap_overview_summary'),
        'recent_applied_changes': session_context.get('recent_applied_changes', []),
        'pending_plan': session_context.get('pending_plan'),
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
    system_prompt = planner._prompt_repository.build_system_prompt(mode=mode, context=prompt_context)

    log_event(
        planner._logger,
        'route_selected',
        settings=planner._settings,
        trace_id=trace_id,
        intent_type=intent_type,
        tool_mode=tool_mode,
        response_mode=response_mode,
        question_style_edit_promoted=bool(state.get('question_style_edit_promoted')),
        edit_to_clarifier_guarded=edit_to_clarifier_guarded,
    )
    return {
        'system_prompt': system_prompt,
        'response_mode': response_mode,
        'tool_mode': tool_mode,
        'trace_id': trace_id,
        'edit_to_clarifier_guarded': edit_to_clarifier_guarded,
        'confirm_without_context': confirm_without_context,
    }


def route_from_intent(state: dict[str, Any]) -> str:
    response_mode = state.get('response_mode', 'chat')
    tool_mode = state.get('tool_mode', 'none')
    if response_mode == 'plan_proposal':
        return 'generate_plan_proposal'
    if tool_mode in {'edit_plan', 'plan_only'}:
        return 'plan_operations'
    if tool_mode == 'context_answer':
        return 'generate_context_answer'
    return 'generate_chat_reply'


def generate_chat_reply(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    system_prompt = state.get('system_prompt', '')
    session_context = state.get('session_context', {})
    history_messages = planner._build_history_messages(session_context)
    trace_id = session_context.get('trace_id')
    fallback_response = planner._rule_based_chat_response(
        user_message,
        state.get('intent_type', 'unclear'),
    )
    if bool(state.get('confirm_without_context')):
        return {
            'assistant_message': fallback_response,
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'confirm_action_missing_context',
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': 'confirm_action_missing_context',
            'tokens_input': None,
            'tokens_output': None,
            'tokens_total': None,
        }

    try:
        result = planner._provider_orchestrator.call(
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
        planner._logger.warning(
            'Provider chat reply failed, using rule-based chat fallback. code=%s message=%s',
            exc.code,
            exc.message,
        )
        return {
            'assistant_message': build_outage_clarifier_message(),
            'planned_operations': [],
            'response_mode': 'chat',
            'preview_recommended': False,
            'parse_mode': 'llm_first_chat_outage',
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': exc.code,
            'tokens_input': exc.tokens_input,
            'tokens_output': exc.tokens_output,
            'tokens_total': exc.tokens_total,
        }


def generate_context_answer(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    system_prompt = state.get('system_prompt', '')
    session_context = state.get('session_context', {})
    history_messages = planner._build_history_messages(session_context)
    return get_context_answer_service(planner).generate(
        user_message=user_message,
        system_prompt=system_prompt,
        session_context=session_context,
        history_messages=history_messages,
        intent_type=state.get('intent_type', 'roadmap_query'),
    )


def _parse_plan_proposal_envelope(raw_text: str) -> tuple[str, dict[str, Any] | None]:
    # The plan_mode template instructs the LLM to emit a JSON object with an
    # `assistant_message` key plus the structured plan fields. If the model
    # honors it, split out the user-facing prose and the payload. If parsing
    # fails, return the raw prose and no payload; the orchestrator will log the
    # skip and the user still sees a chat response.
    if not isinstance(raw_text, str) or not raw_text.strip():
        return '', None
    candidates: list[str] = []
    stripped = raw_text.strip()
    candidates.append(stripped)
    # tolerate fenced code blocks
    if stripped.startswith('```'):
        fenced = stripped.strip('`')
        if fenced.lower().startswith('json'):
            fenced = fenced[4:]
        candidates.append(fenced.strip())
    # tolerate a leading narrative before the JSON object
    first_brace = stripped.find('{')
    last_brace = stripped.rfind('}')
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(stripped[first_brace:last_brace + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if not isinstance(parsed, dict):
            continue
        assistant_message = parsed.pop('assistant_message', None)
        if not isinstance(assistant_message, str) or not assistant_message.strip():
            assistant_message = parsed.get('summary') or ''
        return str(assistant_message).strip(), parsed
    return stripped, None


@dataclass
class _PlanDiscoveryState:
    calls_used: int = 0
    repeat_hits: int = 0
    stop_reason: str | None = None


def _build_plan_discovery_guard(
    *,
    planner: Any,
    session_context: dict[str, Any],
    trace_id: str | None,
) -> tuple[Callable[[str, dict[str, Any]], dict[str, Any]], _PlanDiscoveryState]:
    """Guarded wrapper around the planner's context tool executor for plan
    mode. Enforces the same budget / repeat caps the query lane uses so a
    runaway model cannot loop discovery calls. On exhaustion the guard raises
    ProviderAdapterError which the caller maps to a "finalize with what you
    have" fallback.
    """

    state = _PlanDiscoveryState()
    signature_counts: dict[str, int] = {}
    max_calls = max(1, int(planner._settings.max_discovery_tool_calls))
    max_repeat = max(1, int(planner._settings.max_repeated_tool_calls_per_signature))

    def _tool_signature(tool_name: str, args: dict[str, Any]) -> str:
        normalized_args = json.dumps(
            args,
            ensure_ascii=True,
            sort_keys=True,
            separators=(',', ':'),
            default=str,
        )
        return f'{tool_name}:{normalized_args}'

    def _guarded_execute(
        tool_name: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        signature = _tool_signature(tool_name, args)
        signature_count = signature_counts.get(signature, 0)

        if signature_count >= max_repeat:
            state.repeat_hits += 1
            state.stop_reason = 'repeat_limit_exhausted'
            log_event(
                planner._logger,
                'plan_discovery_stopped',
                settings=planner._settings,
                trace_id=trace_id,
                discovery_calls_used=state.calls_used,
                discovery_repeat_hits=state.repeat_hits,
                discovery_stop_reason=state.stop_reason,
            )
            raise ProviderAdapterError(
                provider='orchestrator',
                code='discovery_repeat_limit_exhausted',
                message='Repeated the same discovery lookup — finalizing the plan.',
            )

        if state.calls_used >= max_calls:
            state.stop_reason = 'budget_exhausted'
            log_event(
                planner._logger,
                'plan_discovery_stopped',
                settings=planner._settings,
                trace_id=trace_id,
                discovery_calls_used=state.calls_used,
                discovery_repeat_hits=state.repeat_hits,
                discovery_stop_reason=state.stop_reason,
            )
            raise ProviderAdapterError(
                provider='orchestrator',
                code='discovery_budget_exhausted',
                message='Discovery budget reached — finalizing the plan.',
            )

        signature_counts[signature] = signature_count + 1
        state.calls_used += 1
        return planner._execute_context_tool(tool_name, args, session_context)

    return _guarded_execute, state


def _build_plan_question_prompt(user_message: str, session_context: dict[str, Any]) -> str:
    roadmap_id = session_context.get('roadmap_id') or ''
    pending_plan = session_context.get('pending_plan') or {}
    accumulated_answers = pending_plan.get('answers') if isinstance(pending_plan, dict) else None
    answers_block = ''
    if isinstance(accumulated_answers, list) and accumulated_answers:
        lines = ['Previous answers from the user in this planning session:']
        for entry in accumulated_answers:
            if not isinstance(entry, dict):
                continue
            q_text = entry.get('question_text') or entry.get('question_id') or '?'
            value = entry.get('custom_answer') or entry.get('selected_option') or ''
            lines.append(f'- Q: {q_text}\n  A: {value}')
        answers_block = '\n' + '\n'.join(lines) + '\n'
    return (
        'Plan the user request below. When discovery tools are available, use '
        'them only when the user references existing work — otherwise skip '
        'straight to an envelope. Do not over-fetch.\n\n'
        'Emit exactly one of the two envelopes defined in the system prompt:\n'
        '  • "needs_answer" — ONE concrete clarifier question with 2-5 '
        'options; only when an answer genuinely changes what you would draft.\n'
        '  • "plan_ready" — terminal envelope with a NON-EMPTY proposed_hierarchy. '
        'Infer reasonable defaults for anything the user did not specify and '
        'state them in rationale. Never return an empty draft.\n\n'
        f'Roadmap ID: {roadmap_id}\n'
        f'User request: {user_message}{answers_block}'
    )


def generate_plan_proposal(
    planner: Any,
    state: dict[str, Any],
) -> dict[str, Any]:
    user_message = state.get('user_message', '')
    system_prompt = state.get('system_prompt', '')
    session_context = state.get('session_context', {})
    history_messages = planner._build_history_messages(session_context)
    trace_id = session_context.get('trace_id')

    if session_context.get('_actor_fetch_future') is not None:
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            resolve_deferred_actor_context,
        )
        resolve_deferred_actor_context(session_context)
    if session_context.get('_roadmap_overview_fetch_future') is not None:
        from app.core.orchestration.planning.planning_pre_dispatcher import (
            resolve_deferred_roadmap_overview_summary,
        )
        resolve_deferred_roadmap_overview_summary(session_context)

    discovery_executor, discovery_state = _build_plan_discovery_guard(
        planner=planner,
        session_context=session_context,
        trace_id=trace_id,
    )
    # Empty roadmap → no discovery tools needed; the overview summary is
    # already in the system prompt. Skipping the tool-use lane saves a full
    # LLM turn and avoids the `empty_response` failure mode we saw when GPT-5
    # consumed reasoning tokens after an obvious tool call.
    overview_text = str(session_context.get('roadmap_overview_summary') or '')
    roadmap_is_empty = (
        '0 epics' in overview_text
        and '0 features' in overview_text
        and '0 tasks' in overview_text
    )
    context_tools = [] if roadmap_is_empty else get_context_tools()
    max_tool_turns = max(1, int(planner._settings.max_discovery_tool_calls))
    question_prompt = _build_plan_question_prompt(user_message, session_context)
    if roadmap_is_empty:
        log_event(
            planner._logger,
            'plan_discovery_skipped',
            settings=planner._settings,
            trace_id=trace_id,
            reason='empty_roadmap',
        )

    def _finalize(
        *,
        raw_text: str,
        provider_used: str,
        fallback_used: bool,
        provider_error_code: str | None,
        tokens_input: int | None,
        tokens_output: int | None,
        tokens_total: int | None,
        stop_reason: str | None,
    ) -> dict[str, Any]:
        assistant_message, payload = _parse_plan_proposal_envelope(raw_text)
        if not assistant_message:
            assistant_message = planner._rule_based_chat_response(
                user_message,
                'roadmap_plan',
            )
        parse_mode = f'{provider_used}_plan_proposal'
        if payload is None:
            parse_mode = f'{provider_used}_plan_proposal_unparsed'
            log_event(
                planner._logger,
                'plan_proposal_envelope_unparsed',
                settings=planner._settings,
                trace_id=trace_id,
                provider_used=provider_used,
                discovery_calls_used=discovery_state.calls_used,
                discovery_repeat_hits=discovery_state.repeat_hits,
                discovery_stop_reason=discovery_state.stop_reason or stop_reason,
            )
        else:
            log_event(
                planner._logger,
                'plan_proposal_generated',
                settings=planner._settings,
                trace_id=trace_id,
                provider_used=provider_used,
                discovery_calls_used=discovery_state.calls_used,
                discovery_repeat_hits=discovery_state.repeat_hits,
                discovery_stop_reason=discovery_state.stop_reason or 'resolved',
            )
        return {
            'assistant_message': assistant_message,
            'planned_operations': [],
            'response_mode': 'plan_proposal',
            'intent_type': 'roadmap_plan',
            'preview_recommended': False,
            'parse_mode': parse_mode,
            'provider_used': provider_used,
            'fallback_used': fallback_used,
            'provider_error_code': provider_error_code,
            'tokens_input': tokens_input,
            'tokens_output': tokens_output,
            'tokens_total': tokens_total,
            'plan_proposal_payload': payload,
        }

    plan_max_tokens = getattr(
        planner._settings, 'openai_plan_max_tokens', None
    )
    try:
        # Both paths go through answer_with_tools — same battle-tested
        # invocation, same token propagation on empty_response. For the
        # greenfield / empty-roadmap case we pass tools=[] so the model must
        # emit the terminal envelope directly; we still use max_tool_turns=1
        # as an explicit ceiling.
        effective_tools = context_tools
        effective_max_turns = max_tool_turns if context_tools else 1
        phase_label = 'plan_proposal' if context_tools else 'plan_proposal_direct'
        result = planner._provider_orchestrator.call(
            lambda adapter: adapter.answer_with_tools(
                system_prompt=system_prompt,
                question_prompt=question_prompt,
                history_messages=history_messages,
                tools=effective_tools,
                tool_executor=discovery_executor,
                max_tool_turns=effective_max_turns,
                max_tokens=plan_max_tokens,
            ),
            trace_context={'trace_id': trace_id, 'phase': phase_label},
        )
        return _finalize(
            raw_text=result.value,
            provider_used=result.provider_used,
            fallback_used=result.fallback_used,
            provider_error_code=result.provider_error_code,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            tokens_total=result.tokens_total,
            stop_reason='resolved',
        )
    except ProviderAdapterError as exc:
        # Discovery budget / repeat caps are soft failures — we still have the
        # plan prompt context and the partial tool observations the provider
        # collected; ask the planner to finalize with what it has.
        if exc.code in {
            'discovery_budget_exhausted',
            'discovery_repeat_limit_exhausted',
            'max_tool_turns_exceeded',
            'empty_response',
        }:
            try:
                finalize_result = planner._provider_orchestrator.call(
                    lambda adapter: adapter.generate_chat_reply(
                        system_prompt=system_prompt,
                        user_message=(
                            'Finalize the plan now with the information you '
                            "already gathered. Emit the JSON envelope exactly "
                            'as described in the system prompt — no more tool '
                            'calls, no additional prose.'
                        ),
                        history_messages=history_messages,
                        max_tokens=plan_max_tokens,
                    ),
                    trace_context={'trace_id': trace_id, 'phase': 'plan_proposal_finalize'},
                )
                return _finalize(
                    raw_text=finalize_result.value,
                    provider_used=finalize_result.provider_used,
                    fallback_used=finalize_result.fallback_used,
                    provider_error_code=finalize_result.provider_error_code,
                    tokens_input=finalize_result.tokens_input,
                    tokens_output=finalize_result.tokens_output,
                    tokens_total=finalize_result.tokens_total,
                    stop_reason=discovery_state.stop_reason or exc.code,
                )
            except ProviderAdapterError as finalize_exc:
                planner._logger.warning(
                    'Plan proposal finalize after discovery stop failed: %s',
                    finalize_exc.code,
                )
                exc = finalize_exc

        planner._logger.warning(
            'Provider plan proposal failed, falling back to outage message. code=%s',
            exc.code,
        )
        return {
            'assistant_message': build_outage_clarifier_message(),
            'planned_operations': [],
            'response_mode': 'chat',
            'intent_type': 'roadmap_plan',
            'preview_recommended': False,
            'parse_mode': 'llm_first_plan_proposal_outage',
            'provider_used': 'rule_based',
            'fallback_used': False,
            'provider_error_code': exc.code,
            'tokens_input': exc.tokens_input,
            'tokens_output': exc.tokens_output,
            'tokens_total': exc.tokens_total,
            'plan_proposal_payload': None,
        }


def get_context_answer_service(planner: Any) -> ContextAnswerService:
    service = getattr(planner, '_context_answer_service', None)
    if service is None:
        service = ContextAnswerService(
            settings=planner._settings,
            logger=planner._logger,
            provider_orchestrator=planner._provider_orchestrator,
            context_answer_cache=planner._context_answer_cache,
            execute_context_tool=planner._execute_context_tool,
            build_context_cache_key=planner._build_context_cache_key,
            chat_fallback_builder=planner._rule_based_chat_response,
        )
        planner._context_answer_service = service
    return service

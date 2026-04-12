from __future__ import annotations

from typing import Any

from app.core.llm.context.context_answer_service import ContextAnswerService
from app.core.llm.outage import build_outage_clarifier_message
from app.core.llm.providers import ProviderAdapterError
from app.core.llm.react.react_executor import map_provider_error_to_stop_reason
from app.core.logging_utils import log_event


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
    heuristic_intent = planner._heuristic_intent(user_message)
    question_style_edit_promoted = False
    is_roadmap_question = planner._is_roadmap_question(
        intent_type=heuristic_intent,
        user_message=user_message,
        session_context=session_context,
    )
    routed_intent = heuristic_intent
    if (
        heuristic_intent in {'general_question', 'question', 'unclear'}
        and planner._is_question_style_edit_request(user_message)
    ):
        routed_intent = 'roadmap_edit'
        question_style_edit_promoted = True
        is_roadmap_question = False
    if heuristic_intent in {'general_question', 'question', 'unclear'} and is_roadmap_question:
        routed_intent = 'roadmap_query'
    parse_mode = (
        'heuristic_question_style_edit_override'
        if question_style_edit_promoted
        else 'heuristic_prerouter'
    )
    log_event(
        planner._logger,
        'intent_classified',
        settings=planner._settings,
        trace_id=trace_id,
        intent_type=routed_intent,
        is_roadmap_question=is_roadmap_question,
        parse_mode=parse_mode,
        question_style_edit_promoted=question_style_edit_promoted,
    )
    return {
        'intent_type': routed_intent,
        'parse_mode': parse_mode,
        'provider_used': 'rule_based',
        'fallback_used': False,
        'provider_error_code': None,
        'is_roadmap_question': is_roadmap_question,
        'question_style_edit_promoted': question_style_edit_promoted,
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
    tool_mode = state.get('tool_mode', 'none')
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
    llm_first_mode_enabled = bool(planner._settings.agent_llm_first_mode_enabled)

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
        if llm_first_mode_enabled:
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

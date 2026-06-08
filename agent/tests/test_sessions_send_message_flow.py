import logging
import unittest
from types import SimpleNamespace
from uuid import UUID

from app.api.routes.sessions_support.route_flows import send_message_flow
from app.core.contracts.sessions import AgentSession, MessageRequest


class _FakeAgentService:
    def __init__(self, outcome: SimpleNamespace) -> None:
        self._outcome = outcome
        self.received_trace_id: str | None = None

    def plan_message(
        self,
        _session: AgentSession,
        _user_message: str,
        _replace: bool,
        _auth_header: str | None,
        trace_id: str,
    ) -> SimpleNamespace:
        self.received_trace_id = trace_id
        return self._outcome


def _build_outcome(session: AgentSession) -> SimpleNamespace:
    return SimpleNamespace(
        session=session,
        assistant_message='Planned response',
        parse_mode='openai_tool_calling',
        intent_type='roadmap_edit',
        response_mode='chat',
        operations=[],
        staged_operations_version=0,
        staged_operations_count=0,
        active_draft_id=None,
        active_draft_version=None,
        provider_used='openai',
        fallback_used=False,
        provider_error_code=None,
        plan_proposal_payload=None,
        clarifier_card=None,
        tokens_input=123,
        tokens_output=45,
        tokens_total=168,
        route_lane='llm_edit_plan',
        llm_skipped_for_simple_edit=False,
        actor_fetch_attempted=False,
        actor_fetch_skipped_reason='simple_edit_turn',
        actor_fetch_ms=None,
        phase_timings={},
        invalid_operation_detected=False,
        invalid_operation_reason=None,
        invalid_operation_index=None,
        pending_edit_context_present=False,
        edit_guard_intervened=False,
        edit_continuation_trigger=None,
        planner_schema_invalid_attempts=0,
        planner_repair_attempted=False,
        deterministic_create_fastpath_skipped=False,
        retry_tool_calls_used=None,
        retry_duplicate_operation_deduped=False,
        retry_autostage_applied=False,
        stop_reason='ready_to_stage',
        react_terminal_action='execute',
        react_loop_turns=1,
        react_loop_budget=4,
        react_loop_termination_reason='ready_to_stage',
        resolve_cache_hits=0,
        resolve_cache_misses=0,
        resolve_dedup_hits=0,
    )


class SendMessageFlowTraceIdTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_message_uses_valid_x_trace_id(self) -> None:
        session = AgentSession(roadmap_id='roadmap-trace-id')
        outcome = _build_outcome(session)
        fake_service = _FakeAgentService(outcome)
        request = SimpleNamespace(
            headers={
                'Authorization': 'Bearer test',
                'X-Trace-Id': 'f607b6ec-a7df-41a8-ab15-ed9fac584f65',
            }
        )
        captured_events: list[tuple[str, dict]] = []

        async def _run_store_call(func, *args):
            return func(*args)

        response = await send_message_flow(
            session_id=session.session_id,
            payload=MessageRequest(message='Rename platform epic'),
            request=request,
            get_agent_runtime_async=lambda: _as_awaitable((object(), fake_service)),
            get_session_or_404_async=lambda _svc, _session_id: _as_awaitable(session),
            run_store_call=_run_store_call,
            resolve_draft_snapshot=lambda _session, _service: ('draft-1', 0, []),
            execute_auto_commit=lambda **_kwargs: _as_awaitable(None),
            schedule_auto_commit_task=lambda _coro: None,
            run_auto_commit_in_background=lambda **_kwargs: _as_awaitable(None),
            extract_upstream_error_code=lambda _detail: None,
            extract_upstream_error_details=lambda _detail: {},
            settings=SimpleNamespace(agent_async_auto_commit_enabled=True),
            logger=logging.getLogger('send-message-flow-tests'),
            log_event_fn=lambda _logger, event, **data: captured_events.append((event, data)),
        )

        self.assertEqual(
            response.debug_trace_id,
            'f607b6ec-a7df-41a8-ab15-ed9fac584f65',
        )
        self.assertEqual(fake_service.received_trace_id, response.debug_trace_id)
        self.assertTrue(any(name == 'message_received' for name, _ in captured_events))
        self.assertTrue(any(name == 'message_completed' for name, _ in captured_events))

    async def test_send_message_generates_uuid_when_trace_id_invalid(self) -> None:
        session = AgentSession(roadmap_id='roadmap-trace-id-invalid')
        outcome = _build_outcome(session)
        fake_service = _FakeAgentService(outcome)
        request = SimpleNamespace(
            headers={
                'Authorization': 'Bearer test',
                'X-Trace-Id': 'not-a-valid-trace-id',
            }
        )

        async def _run_store_call(func, *args):
            return func(*args)

        response = await send_message_flow(
            session_id=session.session_id,
            payload=MessageRequest(message='Assign tasks'),
            request=request,
            get_agent_runtime_async=lambda: _as_awaitable((object(), fake_service)),
            get_session_or_404_async=lambda _svc, _session_id: _as_awaitable(session),
            run_store_call=_run_store_call,
            resolve_draft_snapshot=lambda _session, _service: ('draft-1', 0, []),
            execute_auto_commit=lambda **_kwargs: _as_awaitable(None),
            schedule_auto_commit_task=lambda _coro: None,
            run_auto_commit_in_background=lambda **_kwargs: _as_awaitable(None),
            extract_upstream_error_code=lambda _detail: None,
            extract_upstream_error_details=lambda _detail: {},
            settings=SimpleNamespace(agent_async_auto_commit_enabled=True),
            logger=logging.getLogger('send-message-flow-tests'),
            log_event_fn=lambda *_args, **_kwargs: None,
        )

        self.assertIsNotNone(response.debug_trace_id)
        assert response.debug_trace_id is not None
        parsed = UUID(response.debug_trace_id)
        self.assertEqual(str(parsed), response.debug_trace_id)
        self.assertEqual(fake_service.received_trace_id, response.debug_trace_id)


async def _as_awaitable(value):
    return value


if __name__ == '__main__':
    unittest.main()

import logging
import unittest
from types import SimpleNamespace
from uuid import UUID

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.auto_commit import AutoCommitExecutionResult
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
            settings=SimpleNamespace(
                agent_async_auto_commit_enabled=True,
                agent_summary_trigger_messages=40,
            ),
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
            settings=SimpleNamespace(
                agent_async_auto_commit_enabled=True,
                agent_summary_trigger_messages=40,
            ),
            logger=logging.getLogger('send-message-flow-tests'),
            log_event_fn=lambda *_args, **_kwargs: None,
        )

        self.assertIsNotNone(response.debug_trace_id)
        assert response.debug_trace_id is not None
        parsed = UUID(response.debug_trace_id)
        self.assertEqual(str(parsed), response.debug_trace_id)
        self.assertEqual(fake_service.received_trace_id, response.debug_trace_id)


class _FakeStore:
    def __init__(self) -> None:
        self.updated_sessions: list[AgentSession] = []

    def update(self, session: AgentSession) -> AgentSession:
        self.updated_sessions.append(session)
        return session

    def get(self, _session_id: str) -> AgentSession | None:
        return None


class SendMessageFlowSyncCommitTests(unittest.IsolatedAsyncioTestCase):
    """The commit_summary seam: the web renders 'Committed changes' / failure
    cards and refreshes the canvas from this field alone."""

    def _edit_outcome(self, session: AgentSession) -> SimpleNamespace:
        outcome = _build_outcome(session)
        outcome.response_mode = 'edit_plan'
        outcome.staged_operations_count = 1
        return outcome

    async def _run(self, *, session, fake_service, store, execute_auto_commit, events):
        async def _run_store_call(func, *args):
            return func(*args)

        return await send_message_flow(
            session_id=session.session_id,
            payload=MessageRequest(message='Add an epic called "Launch"'),
            request=SimpleNamespace(headers={'Authorization': 'Bearer test'}),
            get_agent_runtime_async=lambda: _as_awaitable((store, fake_service)),
            get_session_or_404_async=lambda _svc, _sid: _as_awaitable(session),
            run_store_call=_run_store_call,
            resolve_draft_snapshot=lambda _s, _svc: ('draft-1', 1, [SimpleNamespace()]),
            execute_auto_commit=execute_auto_commit,
            schedule_auto_commit_task=lambda _coro: None,
            run_auto_commit_in_background=lambda **_kwargs: _as_awaitable(None),
            extract_upstream_error_code=lambda detail: (
                detail.get('code') if isinstance(detail, dict) else None
            ),
            extract_upstream_error_details=lambda detail: (
                detail if isinstance(detail, dict) else {}
            ),
            settings=SimpleNamespace(
                agent_async_auto_commit_enabled=False,
                agent_summary_trigger_messages=40,
            ),
            logger=logging.getLogger('send-message-flow-tests'),
            log_event_fn=lambda _logger, event, **data: events.append((event, data)),
        )

    async def test_successful_sync_commit_returns_commit_summary(self) -> None:
        session = AgentSession(roadmap_id='roadmap-sync-ok')
        fake_service = _FakeAgentService(self._edit_outcome(session))
        events: list[tuple[str, dict]] = []

        async def _execute_auto_commit(**_kwargs):
            return AutoCommitExecutionResult(
                auto_commit_ms=42,
                staged_operations_version=2,
                staged_operations_count=0,
                active_draft_id=None,
                active_draft_version=None,
                impacted_items=[
                    {
                        'node_id': 'epic-1',
                        'node_type': 'epic',
                        'title': 'Launch',
                        'change_type': 'NODE_ADDED',
                        'impact': 'created',
                    }
                ],
                impacted_item_count=1,
                impacted_summary={'created': 1, 'modified': 0, 'deleted': 0},
                change_id='change-123',
                semantic_diff_summary={'NODE_ADDED': 1},
            )

        response = await self._run(
            session=session,
            fake_service=fake_service,
            store=_FakeStore(),
            execute_auto_commit=_execute_auto_commit,
            events=events,
        )

        assert response.commit_summary is not None
        self.assertTrue(response.commit_summary.committed)
        self.assertEqual(response.commit_summary.change_id, 'change-123')
        self.assertEqual(len(response.commit_summary.impacted_items), 1)
        self.assertEqual(response.commit_summary.impacted_items[0].title, 'Launch')
        self.assertEqual(response.staged_operations_count, 0)

    async def test_failed_sync_commit_discards_staged_ops_and_reports(self) -> None:
        session = AgentSession(roadmap_id='roadmap-sync-fail')
        session.operations = []
        fake_service = _FakeAgentService(self._edit_outcome(session))
        store = _FakeStore()
        events: list[tuple[str, dict]] = []

        async def _execute_auto_commit(**_kwargs):
            raise HTTPException(
                status_code=422,
                detail={'code': 'INVALID_OPERATION', 'message': 'Parent epic not found.'},
            )

        response = await self._run(
            session=session,
            fake_service=fake_service,
            store=store,
            execute_auto_commit=_execute_auto_commit,
            events=events,
        )

        # The web's deterministic failure signal.
        assert response.commit_summary is not None
        self.assertFalse(response.commit_summary.committed)
        self.assertEqual(response.commit_summary.error_code, 'INVALID_OPERATION')
        self.assertEqual(
            response.commit_summary.error_message,
            'Parent epic not found.',
        )
        # Staged ops are a dead end without an apply/discard UI — they must be
        # gone so the next turn starts clean instead of retrying a bad op.
        self.assertEqual(response.staged_operations_count, 0)
        self.assertEqual(session.operations, [])
        self.assertEqual(store.updated_sessions, [session])
        failure_events = [d for n, d in events if n == 'auto_commit_sync_failed']
        self.assertEqual(len(failure_events), 1)
        self.assertTrue(failure_events[0].get('staged_operations_discarded'))


async def _as_awaitable(value):
    return value


if __name__ == '__main__':
    unittest.main()

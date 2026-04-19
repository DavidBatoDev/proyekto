from __future__ import annotations

import unittest

from fastapi.exceptions import HTTPException

from app.api.routes.sessions_support.auto_commit import execute_auto_commit
from app.api.routes.sessions_support.common import (
    extract_upstream_error_code,
    extract_upstream_error_details,
)
from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession


class SessionsSupportCommonTests(unittest.TestCase):
    def test_extract_upstream_error_details_from_nested_error_payload(self) -> None:
        detail = {
            'detail': {
                'error': {
                    'code': 'INVALID_OPERATION',
                    'message': 'operations.0.patch is required',
                }
            }
        }

        parsed = extract_upstream_error_details(detail)

        self.assertEqual(parsed.get('code'), 'INVALID_OPERATION')
        self.assertEqual(parsed.get('message'), 'operations.0.patch is required')
        self.assertIsNone(parsed.get('status_code'))
        self.assertEqual(extract_upstream_error_code(detail), 'INVALID_OPERATION')

    def test_extract_upstream_error_details_falls_back_to_error_and_status(self) -> None:
        detail = {
            'statusCode': 400,
            'error': 'Bad Request',
            'message': 'Validation failed',
        }

        parsed = extract_upstream_error_details(detail)

        self.assertEqual(parsed.get('code'), 'BAD_REQUEST')
        self.assertEqual(parsed.get('status_code'), 400)
        self.assertEqual(parsed.get('error'), 'Bad Request')
        self.assertEqual(parsed.get('message'), 'Validation failed')
        self.assertEqual(extract_upstream_error_code(detail), 'BAD_REQUEST')


class AutoCommitObservabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_execute_auto_commit_enriches_400_with_invalid_operation_snapshot(self) -> None:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        invalid_operation = RoadmapOperation(
            op='update_node',
            node_type='task',
            node_id='123e4567-e89b-12d3-a456-426614174000',
        )

        class _FakeNestClient:
            async def commit(self, **_kwargs):
                raise HTTPException(
                    status_code=400,
                    detail={
                        'statusCode': 400,
                        'error': 'Bad Request',
                        'message': 'Invalid operation payload',
                    },
                )

        async def _run_store_call(*_args, **_kwargs):
            return None

        with self.assertRaises(HTTPException) as ctx:
            await execute_auto_commit(
                store=object(),
                agent_service=object(),
                session=session,
                auth_header='Bearer test',
                trace_id='trace-auto-commit-observability',
                nest_client=_FakeNestClient(),
                draft_graph_enabled=False,
                resolve_draft_snapshot=lambda _session, _service: ('draft-1', 1, [invalid_operation]),
                reuse_selected_draft_as_post_commit_head=lambda *_args, **_kwargs: 1,
                set_draft_status=lambda **_kwargs: True,
                build_commit_artifact=lambda *_args, **_kwargs: None,
                serialized_payload_bytes=lambda _payload: 0,
                run_store_call=_run_store_call,
            )

        detail = ctx.exception.detail
        self.assertIsInstance(detail, dict)
        assert isinstance(detail, dict)
        invalid_snapshot = detail.get('_auto_commit_invalid_operation')
        self.assertIsInstance(invalid_snapshot, dict)
        assert isinstance(invalid_snapshot, dict)
        self.assertEqual(invalid_snapshot.get('reason'), 'update_node.mutation_missing')
        self.assertEqual(invalid_snapshot.get('index'), 0)


class AutoCommitStaleRevisionRetryTests(unittest.IsolatedAsyncioTestCase):
    def _make_session(self, *, revision_token: str = 'stale-token') -> AgentSession:
        session = AgentSession(roadmap_id='55e431e2-e416-468c-a973-94d97280e97d')
        session.session_id = 'session-1'
        session.revision_token = revision_token
        return session

    def _valid_op(self) -> RoadmapOperation:
        return RoadmapOperation(
            op='delete_node',
            node_type='epic',
            node_id='123e4567-e89b-12d3-a456-426614174000',
        )

    async def _invoke(
        self,
        *,
        session: AgentSession,
        nest_client: object,
        draft_operation: RoadmapOperation | None = None,
    ) -> None:
        op = draft_operation or self._valid_op()

        async def _run_store_call(*_args, **_kwargs):
            return None

        class _FakeStore:
            async def update(self, *_args, **_kwargs):
                return None

        class _FakeAgentService:
            record_recent_targets_from_preview = None

            def ensure_draft_graph_initialized(self, *_args, **_kwargs):
                return None

        await execute_auto_commit(
            store=_FakeStore(),
            agent_service=_FakeAgentService(),
            session=session,
            auth_header='Bearer test',
            trace_id='trace-stale-revision-retry',
            nest_client=nest_client,
            draft_graph_enabled=False,
            resolve_draft_snapshot=lambda _s, _a: ('draft-1', 1, [op]),
            reuse_selected_draft_as_post_commit_head=lambda *_a, **_k: 1,
            set_draft_status=lambda **_k: True,
            build_commit_artifact=lambda *_a, **_k: None,
            serialized_payload_bytes=lambda _p: 0,
            run_store_call=_run_store_call,
        )

    async def test_retries_once_on_stale_revision_and_succeeds(self) -> None:
        session = self._make_session(revision_token='stale-token')

        class _FakeNestClient:
            def __init__(self) -> None:
                self.commit_calls: list[dict[str, object]] = []
                self.summary_calls = 0

            async def commit(self, *, payload, **_kwargs):
                self.commit_calls.append(payload)
                if len(self.commit_calls) == 1:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            'code': 'STALE_REVISION',
                            'message': 'Revision token does not match current roadmap revision',
                        },
                    )
                return {
                    'change_id': '11111111-1111-1111-1111-111111111111',
                    'revision_token': 'fresh-token',
                    'semantic_diff': {'summary': {}, 'changes': []},
                }

            async def context_summary(self, **_kwargs):
                self.summary_calls += 1
                return {'revision_token': 'fresh-token'}

        client = _FakeNestClient()
        await self._invoke(session=session, nest_client=client)
        self.assertEqual(len(client.commit_calls), 2)
        self.assertEqual(client.commit_calls[0].get('revision_token'), 'stale-token')
        self.assertEqual(client.commit_calls[1].get('revision_token'), 'fresh-token')
        self.assertEqual(session.revision_token, 'fresh-token')
        self.assertEqual(client.summary_calls, 1)

    async def test_does_not_retry_on_non_stale_409(self) -> None:
        session = self._make_session(revision_token='stale-token')

        class _FakeNestClient:
            def __init__(self) -> None:
                self.commit_calls = 0
                self.summary_calls = 0

            async def commit(self, **_kwargs):
                self.commit_calls += 1
                raise HTTPException(
                    status_code=409,
                    detail={
                        'code': 'CONFLICT_OTHER',
                        'message': 'Unrelated conflict',
                    },
                )

            async def context_summary(self, **_kwargs):
                self.summary_calls += 1
                return {'revision_token': 'fresh-token'}

        client = _FakeNestClient()
        with self.assertRaises(HTTPException) as ctx:
            await self._invoke(session=session, nest_client=client)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(client.commit_calls, 1)
        self.assertEqual(client.summary_calls, 0)
        self.assertEqual(session.revision_token, 'stale-token')

    async def test_second_stale_revision_409_propagates(self) -> None:
        session = self._make_session(revision_token='stale-token')

        class _FakeNestClient:
            def __init__(self) -> None:
                self.commit_calls = 0

            async def commit(self, **_kwargs):
                self.commit_calls += 1
                raise HTTPException(
                    status_code=409,
                    detail={
                        'code': 'STALE_REVISION',
                        'message': 'Revision token does not match current roadmap revision',
                    },
                )

            async def context_summary(self, **_kwargs):
                return {'revision_token': 'fresh-token'}

        client = _FakeNestClient()
        with self.assertRaises(HTTPException) as ctx:
            await self._invoke(session=session, nest_client=client)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(client.commit_calls, 2)

    async def test_no_retry_when_summary_returns_same_token(self) -> None:
        session = self._make_session(revision_token='stuck-token')

        class _FakeNestClient:
            def __init__(self) -> None:
                self.commit_calls = 0
                self.summary_calls = 0

            async def commit(self, **_kwargs):
                self.commit_calls += 1
                raise HTTPException(
                    status_code=409,
                    detail={
                        'code': 'STALE_REVISION',
                        'message': 'Revision token does not match current roadmap revision',
                    },
                )

            async def context_summary(self, **_kwargs):
                self.summary_calls += 1
                return {'revision_token': 'stuck-token'}

        client = _FakeNestClient()
        with self.assertRaises(HTTPException):
            await self._invoke(session=session, nest_client=client)
        # No retry fired because the refreshed token matched the stale one.
        self.assertEqual(client.commit_calls, 1)
        self.assertEqual(client.summary_calls, 1)


if __name__ == '__main__':
    unittest.main()

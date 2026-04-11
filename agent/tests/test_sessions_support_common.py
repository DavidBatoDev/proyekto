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


if __name__ == '__main__':
    unittest.main()

import logging
import unittest

from fastapi import HTTPException

from app.api.routes import sessions as sessions_routes
from app.core.config import get_settings
from app.core.contracts.sessions import (
    AgentSession,
    PendingDisambiguation,
    ResolverCandidate,
    SessionMetadata,
)
from app.core.llm.client import PlanningResult
from app.core.orchestration.agent_service import AgentService
from app.core.session_store import SessionStoreUnavailableError


class _FakeNestClient:
    def __init__(self, response: dict) -> None:
        self._response = response

    def context_search(self, **_kwargs):  # sync by design for this unit test
        return self._response


class AgentSafetyTests(unittest.TestCase):
    def _service(self, search_response: dict) -> AgentService:
        service = object.__new__(AgentService)
        service._settings = get_settings()
        service._logger = logging.getLogger('agent-safety-tests')
        service._nest_client = _FakeNestClient(search_response)
        service._run_async_call = lambda value: value
        return service

    def _planning(self) -> PlanningResult:
        return PlanningResult(
            assistant_message='fallback',
            operations=[],
            parse_mode='rule_based_edit',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            preview_recommended=False,
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code='missing_tool_call',
            tokens_input=None,
            tokens_output=None,
            tokens_total=None,
        )

    def _session_with_pending(self) -> AgentSession:
        return AgentSession(
            roadmap_id='roadmap-1',
            metadata=SessionMetadata(
                pending_disambiguation=PendingDisambiguation(
                    kind='rename_node',
                    label='Legacy Epic',
                    node_type='epic',
                    new_title='Legacy Epic Renamed',
                    candidates=[
                        ResolverCandidate(
                            id='old-node-id',
                            type='epic',
                            title='Legacy Epic',
                        )
                    ],
                )
            ),
        )

    def test_new_rename_intent_has_priority_over_pending_selection(self) -> None:
        service = self._service(
            {
                'matches': [
                    {
                        'id': 'new-node-id',
                        'type': 'epic',
                        'title': 'Platform Foundation',
                    }
                ]
            }
        )
        session = self._session_with_pending()

        result = service._apply_deterministic_resolution(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-1',
        )

        self.assertEqual(result.parse_mode, 'deterministic_resolver_rename')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].node_id, 'new-node-id')
        self.assertEqual(result.operations[0].patch, {'title': 'Platform Foundation1'})
        self.assertIsNone(session.metadata.pending_disambiguation)

    def test_strict_selection_consumes_pending_only(self) -> None:
        service = self._service({'matches': []})
        session = self._session_with_pending()

        result = service._apply_deterministic_resolution(
            session=session,
            user_message='option 1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-2',
        )

        self.assertEqual(result.parse_mode, 'deterministic_disambiguation_selected')
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.operations[0].node_id, 'old-node-id')
        self.assertEqual(result.operations[0].patch, {'title': 'Legacy Epic Renamed'})
        self.assertIsNone(session.metadata.pending_disambiguation)


class SessionRouteSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_store_unavailable_response_is_sanitized(self) -> None:
        def _raise_store_error():
            raise SessionStoreUnavailableError('get', 'dns failure: internal-hostname')

        with self.assertRaises(HTTPException) as raised:
            await sessions_routes._run_store_call(_raise_store_error)

        exc = raised.exception
        self.assertEqual(exc.status_code, 503)
        self.assertEqual(exc.detail.get('code'), 'SERVICE_UNAVAILABLE')
        self.assertTrue(exc.detail.get('retryable'))
        self.assertNotIn('reason', exc.detail)


if __name__ == '__main__':
    unittest.main()

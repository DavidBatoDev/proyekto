import logging
import unittest
from types import SimpleNamespace

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
from app.core.llm.client import LLMPlanner
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

    def test_backend_close_scores_keep_ambiguity(self) -> None:
        service = self._service(
            {
                'matches': [
                    {'id': 'n1', 'type': 'epic', 'title': 'Platform Foundation', 'score': 1.0},
                    {'id': 'n2', 'type': 'epic', 'title': 'Platform Foundation v2', 'score': 0.93},
                ]
            }
        )
        session = AgentSession(roadmap_id='roadmap-1')
        result = service._apply_deterministic_resolution(
            session=session,
            user_message='Rename Platform Foundation epic to Platform Foundation1',
            planning=self._planning(),
            auth_header=None,
            trace_id='trace-3',
        )
        self.assertEqual(result.parse_mode, 'deterministic_resolver_disambiguation')
        self.assertEqual(len(result.operations), 0)
        self.assertIsNotNone(session.metadata.pending_disambiguation)


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


class PlannerContextSafetyTests(unittest.TestCase):
    def _planner(self) -> LLMPlanner:
        planner = object.__new__(LLMPlanner)
        planner._settings = get_settings()
        planner._logger = logging.getLogger('planner-context-safety-tests')
        planner._nest_client = SimpleNamespace()
        planner._run_async_context_call = lambda value: value
        return planner

    def test_invalid_parent_id_returns_invalid_uuid_error(self) -> None:
        planner = self._planner()
        result = planner._execute_context_tool(
            'get_children',
            {
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'parent_id': 'invalid-parent-id',
                'limit': 10,
            },
            {'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
        )
        self.assertIn('error', result)
        self.assertEqual(result['error']['code'], 'INVALID_UUID')

    def test_deterministic_features_fast_path_composes_response(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'unique',
                    'selected': {
                        'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                        'title': 'Platform Foundation',
                    },
                }
            if name == 'get_features':
                return {
                    'children': [
                        {'id': '1', 'type': 'feature', 'title': 'Authentication'},
                        {'id': '2', 'type': 'feature', 'title': 'Billing'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_features_answer(
            user_message='What are the features of Platform Foundation?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-fast',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Features under "Platform Foundation"', outcome.answer)
        self.assertIn('- Authentication', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_features_ambiguity_sets_pending_resolution(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                return {
                    'status': 'ambiguous',
                    'resolution_id': 'res-123',
                    'matches': [
                        {'id': '1', 'type': 'epic', 'title': 'Platform Foundation'},
                        {'id': '2', 'type': 'epic', 'title': 'Platform Foundation Core'},
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_features_answer(
            user_message='What are the features of the epic Platform Foundation?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-ambiguous',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Please choose one', outcome.answer)
        self.assertIsNotNone(outcome.pending_context_resolution)
        assert outcome.pending_context_resolution is not None
        self.assertEqual(outcome.pending_context_resolution.get('resolution_id'), 'res-123')
        self.assertFalse(outcome.clear_pending_context_resolution)

    def test_pending_resolution_selection_short_circuits_provider(self) -> None:
        planner = self._planner()
        observed_choice = {'value': None}

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                observed_choice['value'] = args.get('choice')
                if args.get('choice') == 1:
                    return {
                        'children': [
                            {'id': 'f1', 'type': 'feature', 'title': 'Authentication'},
                            {'id': 'f2', 'type': 'feature', 'title': 'Billing'},
                        ]
                    }
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-123',
                    'label': 'Platform Foundation',
                    'node_type': 'epic',
                    'option_choices': [1, 2],
                },
            },
            trace_id='trace-select',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertEqual(observed_choice['value'], 1)
        self.assertIn('Features under "Platform Foundation"', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_pending_selection_uses_backend_choice_mapping(self) -> None:
        planner = self._planner()
        observed_choice = {'value': None}

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                observed_choice['value'] = args.get('choice')
                return {'children': [{'id': 'f1', 'type': 'feature', 'title': 'Authentication'}]}
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'features_of_epic',
                    'resolution_id': 'res-123',
                    'label': 'Platform Foundation',
                    'node_type': 'epic',
                    'option_choices': [3, 4],
                },
            },
            trace_id='trace-select-mapped',
        )
        self.assertIsNotNone(outcome)
        self.assertEqual(observed_choice['value'], 3)

    def test_deterministic_tasks_fast_path_composes_response(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'resolve_node_reference':
                self.assertEqual(args.get('node_type'), 'feature')
                return {
                    'status': 'unique',
                    'selected': {
                        'id': '60bcab3f-3989-448d-9c84-3261cf38685b',
                        'title': 'Authentication System',
                    },
                }
            if name == 'get_children':
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Design auth DB schema'},
                        {'id': 't2', 'type': 'task', 'title': 'Implement login API'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_tasks_answer(
            user_message='What are the tasks for the Authentication System?',
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-tasks',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Tasks under "Authentication System"', outcome.answer)
        self.assertIn('- Design auth DB schema', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_pending_resolution_selection_supports_tasks_kind(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_children_from_resolution':
                self.assertEqual(args.get('choice'), 1)
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Design auth DB schema'},
                    ]
                }
            return {'error': {'code': 'INVALID_ARGUMENT'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_pending_context_selection(
            user_message='option 1',
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'tasks_of_feature',
                    'resolution_id': 'res-task-123',
                    'label': 'Authentication System',
                    'node_type': 'feature',
                },
            },
            trace_id='trace-task-select',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Tasks under "Authentication System"', outcome.answer)
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_epics_fast_path_without_ids(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'title': 'Platform Foundation',
                            'status': 'in_progress',
                            'feature_count': 2,
                        },
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('epics_in_roadmap')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('This roadmap has 1 epic', outcome.answer)
        self.assertIn('Platform Foundation', outcome.answer)
        self.assertNotIn('id:', outcome.answer.lower())
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_deterministic_epics_fast_path_with_ids(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {
                            'id': 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
                            'title': 'Platform Foundation',
                            'status': 'in_progress',
                            'feature_count': 2,
                        },
                    ],
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('epics_in_roadmap')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=True,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics-ids',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('id: dad5697a-8962-4f80-8bc3-8a964edd8e56', outcome.answer.lower())

    def test_deterministic_epics_matcher_and_summary_failure_fallback(self) -> None:
        planner = self._planner()
        match = planner._match_deterministic_context_intent('Tell me all the epics in this roadmap')
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.parse_mode, 'deterministic_context_epics')
        self.assertEqual(label, '')

        def fake_execute(_name: str, _args: dict, _ctx: dict):
            return {'error': {'code': 'CONTEXT_TOOL_FAILED'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-epics-fallback',
        )
        self.assertIsNone(outcome)

    def test_global_overview_matcher_detects_compound_roadmap_query(self) -> None:
        planner = self._planner()
        match = planner._match_global_overview_intent(
            'Tell me all the epics, features and tasks of this roadmap'
        )
        self.assertIsNotNone(match)
        assert match is not None
        intent, label = match
        self.assertEqual(intent.parse_mode, 'deterministic_context_overview')
        self.assertEqual(label, '')

    def test_generic_label_redirects_to_overview_without_resolver(self) -> None:
        planner = self._planner()
        called_tools: list[str] = []

        def fake_execute(name: str, _args: dict, _ctx: dict):
            called_tools.append(name)
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [],
                }
            return {'children': []}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('tasks_of_feature')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='this roadmap',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-generic-label',
        )
        self.assertIsNotNone(outcome)
        self.assertIn('get_roadmap_summary', called_tools)
        self.assertNotIn('resolve_node_reference', called_tools)

    def test_overview_call_budget_truncates_output(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [
                        {'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e2', 'title': 'Epic B', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e3', 'title': 'Epic C', 'status': 'todo', 'feature_count': 3},
                        {'id': 'e4', 'title': 'Epic D', 'status': 'todo', 'feature_count': 3},
                    ],
                }
            if name == 'get_features':
                return {
                    'children': [
                        {'id': f"{args['epic_id']}-f1", 'type': 'feature', 'title': 'Feature 1'},
                        {'id': f"{args['epic_id']}-f2", 'type': 'feature', 'title': 'Feature 2'},
                        {'id': f"{args['epic_id']}-f3", 'type': 'feature', 'title': 'Feature 3'},
                    ]
                }
            if name == 'get_children':
                return {
                    'children': [
                        {'id': 't1', 'type': 'task', 'title': 'Task 1'},
                        {'id': 't2', 'type': 'task', 'title': 'Task 2'},
                        {'id': 't3', 'type': 'task', 'title': 'Task 3'},
                        {'id': 't4', 'type': 'task', 'title': 'Task 4'},
                        {'id': 't5', 'type': 'task', 'title': 'Task 5'},
                        {'id': 't6', 'type': 'task', 'title': 'Task 6'},
                    ]
                }
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview-budget',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertIn('Results were truncated for performance', outcome.answer)

    def test_global_overview_query_bypasses_pending_selection(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [{'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 0}],
                }
            if name == 'get_features':
                return {'children': []}
            if name == 'get_children':
                return {'children': []}
            if name == 'get_children_from_resolution':
                return {'error': {'code': 'SHOULD_NOT_BE_CALLED'}}
            return {'error': {'code': 'UNKNOWN'}}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        overview_match = planner._match_global_overview_intent('I meant this overall roadmap')
        self.assertIsNotNone(overview_match)
        assert overview_match is not None
        intent, label = overview_match
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label=label,
            include_ids=False,
            session_context={
                'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                'pending_context_resolution': {
                    'kind': 'tasks_of_feature',
                    'resolution_id': 'res-task-123',
                    'label': 'Authentication System',
                    'node_type': 'feature',
                },
            },
            trace_id='trace-overview-pending',
        )
        self.assertIsNotNone(outcome)
        assert outcome is not None
        self.assertTrue(outcome.clear_pending_context_resolution)

    def test_overview_tool_error_returns_none_for_provider_fallback(self) -> None:
        planner = self._planner()

        def fake_execute(name: str, _args: dict, _ctx: dict):
            if name == 'get_roadmap_summary':
                return {
                    'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d',
                    'epics': [{'id': 'e1', 'title': 'Epic A', 'status': 'todo', 'feature_count': 1}],
                }
            if name == 'get_features':
                return {'error': {'code': 'CONTEXT_TOOL_FAILED'}}
            return {'children': []}

        planner._execute_context_tool = fake_execute  # type: ignore[method-assign]
        intent = planner._get_deterministic_context_intent('roadmap_overview')
        self.assertIsNotNone(intent)
        assert intent is not None
        outcome = planner._try_deterministic_list_answer(
            intent=intent,
            label='',
            include_ids=False,
            session_context={'roadmap_id': '55e431e2-e416-468c-a973-94d97280e97d'},
            trace_id='trace-overview-fallback',
        )
        self.assertIsNone(outcome)


if __name__ == '__main__':
    unittest.main()

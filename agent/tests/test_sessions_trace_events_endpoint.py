import logging
import unittest

from fastapi.testclient import TestClient

from app.api.routes import sessions as sessions_routes
from app.core import logging_utils
from app.main import app


class TraceEventsEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)
        cls.logger = logging.getLogger('trace-events-endpoint-tests')

    def setUp(self) -> None:
        logging_utils._PROGRESS_TRACES.clear()
        self._previous_enabled = sessions_routes.settings.agent_progress_events_enabled
        self._previous_allow_verbose = (
            sessions_routes.settings.agent_progress_events_allow_verbose
        )
        sessions_routes.settings.agent_progress_events_enabled = True
        sessions_routes.settings.agent_progress_events_allow_verbose = True

    def tearDown(self) -> None:
        logging_utils._PROGRESS_TRACES.clear()
        sessions_routes.settings.agent_progress_events_enabled = self._previous_enabled
        sessions_routes.settings.agent_progress_events_allow_verbose = (
            self._previous_allow_verbose
        )

    def test_events_endpoint_supports_after_seq_pagination(self) -> None:
        trace_id = '0372f022-894f-4bfd-8b89-f8d95aa26f63'
        session_id = 'session-pagination'
        roadmap_id = 'roadmap-pagination'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            message='Assign to me all tasks',
        )
        logging_utils.log_event(
            self.logger,
            'intent_classified',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            intent_type='roadmap_edit',
            parse_mode='heuristic_prerouter',
        )
        logging_utils.log_event(
            self.logger,
            'message_completed',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            response_mode='edit_plan',
            elapsed_ms=1500,
        )

        first = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'after_seq': 0, 'limit': 2, 'detail': 'verbose'},
        )
        self.assertEqual(first.status_code, 200)
        first_payload = first.json()
        self.assertEqual([event['seq'] for event in first_payload['events']], [1, 2])
        self.assertEqual(first_payload['next_seq'], 2)
        self.assertTrue(first_payload['done'])

        second = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'after_seq': first_payload['next_seq'], 'limit': 50, 'detail': 'verbose'},
        )
        self.assertEqual(second.status_code, 200)
        second_payload = second.json()
        self.assertEqual([event['seq'] for event in second_payload['events']], [3])
        self.assertEqual(second_payload['next_seq'], 3)

    def test_events_endpoint_detail_mode_and_verbose_redaction(self) -> None:
        trace_id = 'ef8f4e8b-8475-4190-8395-f9fc9b12d74c'
        session_id = 'session-detail-mode'
        roadmap_id = 'roadmap-detail-mode'
        logging_utils.log_event(
            self.logger,
            'tool_call_requested',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            tool_name='resolve_node_reference',
            arg_keys=['label', 'limit', 'roadmap_id'],
            tool_args={
                'label': 'Platform Foundation',
                'limit': 5,
                'roadmap_id': roadmap_id,
            },
        )

        verbose = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'detail': 'verbose'},
        )
        self.assertEqual(verbose.status_code, 200)
        verbose_details = verbose.json()['events'][0].get('details') or {}
        self.assertIn('session_id', verbose_details)
        self.assertIn('roadmap_id', verbose_details)

        structured = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'detail': 'structured'},
        )
        self.assertEqual(structured.status_code, 200)
        structured_details = structured.json()['events'][0].get('details') or {}
        self.assertEqual(
            set(structured_details.keys()),
            {'arg_keys', 'tool_args', 'tool_name'},
        )

        sessions_routes.settings.agent_progress_events_allow_verbose = False
        forced_structured = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'detail': 'verbose'},
        )
        self.assertEqual(forced_structured.status_code, 200)
        forced_details = forced_structured.json()['events'][0].get('details') or {}
        self.assertEqual(
            set(forced_details.keys()),
            {'arg_keys', 'tool_args', 'tool_name'},
        )

    def test_events_endpoint_includes_planner_summary_event(self) -> None:
        trace_id = 'f680e7a0-85b4-4f48-8e4c-aa511f7f0cfd'
        session_id = 'session-planner-summary'
        roadmap_id = 'roadmap-planner-summary'
        logging_utils.log_event(
            self.logger,
            'planner_summary',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id=roadmap_id,
            response_mode='edit_plan',
            summary_text='I reviewed context and prepared 2 updates for staging.',
            summary_source='model_assistant_message',
            operations_count=2,
            operation_types=['update_node', 'mark_status'],
        )

        response = self.client.get(
            f'/agent/sessions/{session_id}/traces/{trace_id}/events',
            params={'detail': 'structured'},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload['events']), 1)
        event = payload['events'][0]
        self.assertEqual(event['event'], 'planner_summary')
        self.assertEqual(event['title'], 'Planner summary')
        self.assertEqual(event['status'], 'success')
        self.assertEqual(
            event['summary'],
            'I reviewed context and prepared 2 updates for staging.',
        )
        details = event.get('details') or {}
        self.assertEqual(details.get('summary_source'), 'model_assistant_message')
        self.assertEqual(details.get('operations_count'), 2)

    def test_events_endpoint_unknown_or_mismatched_trace_returns_404(self) -> None:
        missing = self.client.get(
            '/agent/sessions/session-404/traces/missing-trace/events',
        )
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()['detail']['code'], 'TRACE_EVENTS_NOT_FOUND')

        trace_id = '4dbf4ec9-97ac-4f42-8cd8-ddeb9482f564'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=sessions_routes.settings,
            trace_id=trace_id,
            session_id='session-a',
            roadmap_id='roadmap-a',
            message='Rename epic',
        )
        mismatched = self.client.get(
            f'/agent/sessions/session-b/traces/{trace_id}/events',
        )
        self.assertEqual(mismatched.status_code, 404)
        self.assertEqual(mismatched.json()['detail']['code'], 'TRACE_EVENTS_NOT_FOUND')


if __name__ == '__main__':
    unittest.main()

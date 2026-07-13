import io
import json
import logging
import unittest
from types import SimpleNamespace

from app.core import logging_utils
from app.core.v2 import progress


class _TTYStringIO(io.StringIO):
    def __init__(self, *, tty: bool) -> None:
        super().__init__()
        self._tty = tty

    def isatty(self) -> bool:
        return self._tty


class LoggingUtilsLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stream = _TTYStringIO(tty=False)
        self.logger = logging.getLogger(f'logging-utils-tests-{id(self)}')
        self.logger.handlers.clear()
        self.logger.propagate = False
        self.logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(self.stream)
        handler.setFormatter(logging.Formatter('%(message)s'))
        self.logger.addHandler(handler)
        logging_utils._LIFECYCLE_TRACES.clear()
        logging_utils._PROGRESS_TRACES.clear()
        self.settings_pretty = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='auto',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )
        self.settings_json = SimpleNamespace(
            agent_log_json=True,
            agent_log_color='auto',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )

    def _emit_minimal_lifecycle(self) -> str:
        trace_id = 'trace-1'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-1',
            roadmap_id='roadmap-1',
            message='Tell me all tasks assigned to me',
            replace_operations=False,
            actor_present=True,
            roadmap_role='editor',
            actor_context_source='backend_context_actor',
        )
        logging_utils.log_event(
            self.logger,
            'intent_classified',
            settings=self.settings_pretty,
            trace_id=trace_id,
            intent_type='question',
            is_roadmap_question=True,
            parse_mode='context_my_tasks',
        )
        logging_utils.log_event(
            self.logger,
            'route_selected',
            settings=self.settings_pretty,
            trace_id=trace_id,
            response_mode='chat',
            tool_mode='context_answer',
            intent_type='question',
        )
        logging_utils.log_event(
            self.logger,
            'tool_call_requested',
            settings=self.settings_pretty,
            trace_id=trace_id,
            tool_name='get_tasks_assigned_to_me',
            tool_args={'status': 'all', 'limit': 100},
            arg_keys=['limit', 'status'],
            roadmap_id='roadmap-1',
        )
        logging_utils.log_event(
            self.logger,
            'tool_call_result',
            settings=self.settings_pretty,
            trace_id=trace_id,
            tool_name='get_tasks_assigned_to_me',
            result_summary={'result_type': 'dict', 'tasks_count': 2},
        )
        logging_utils.log_event(
            self.logger,
            'llm_planned_operation',
            settings=self.settings_pretty,
            trace_id=trace_id,
            provider_used='openai',
            operation_index=0,
            operation={
                'op': 'mark_status',
                'node_type': 'task',
                'node_id': '123e4567-e89b-12d3-a456-426614174000',
                'status': 'in_review',
            },
        )
        logging_utils.log_event(
            self.logger,
            'message_completed',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-1',
            roadmap_id='roadmap-1',
            intent_type='question',
            response_mode='chat',
            provider_used='rule_based',
            fallback_used=False,
            provider_error_code=None,
            assistant_message='Tasks assigned to you: Task A, Task B',
            tokens_input=None,
            tokens_output=None,
            tokens_total=None,
            operations_count=0,
            artifacts_count=0,
            staged_changes_present=False,
            elapsed_ms=1234,
            actor_present=True,
            roadmap_role='editor',
            actor_context_source='backend_context_actor',
            route_lane='deterministic_fastpath',
            stop_reason='ready_to_stage',
            react_terminal_action='execute',
            react_loop_turns=2,
            react_loop_budget=3,
            react_loop_termination_reason='terminal',
            discovery_stop_reason='resolved',
            clarifier_returned=False,
            edit_guard_intervened=True,
            retry_tool_calls_used=2,
            retry_duplicate_operation_deduped=True,
            retry_autostage_applied=True,
        )
        return self.stream.getvalue()

    def test_pretty_mode_emits_consolidated_lifecycle_block(self) -> None:
        output = self._emit_minimal_lifecycle()
        self.assertIn('EVENT: INTENT_CLASSIFIED', output)
        self.assertIn('EVENT: ROUTE_SELECTED', output)
        self.assertIn('EVENT: TOOL_CALL_REQUESTED', output)
        self.assertIn('EVENT: TOOL_CALL_RESULT', output)
        self.assertIn('AI REQUEST: MY TASKS', output)
        self.assertIn('trace_id     trace-1', output)
        self.assertIn('USER', output)
        self.assertIn('ROUTING', output)
        self.assertIn('TOOL CALL', output)
        self.assertIn('get_tasks_assigned_to_me', output)
        self.assertIn('LLM OPERATIONS', output)
        self.assertIn('mark_status', output)
        self.assertIn('RESPONSE', output)
        self.assertIn('ASSISTANT', output)
        self.assertIn('lane        deterministic_fastpath', output)
        self.assertIn('guard       yes', output)
        self.assertIn('retry_calls 2', output)
        self.assertIn('retry_dedupe yes', output)
        self.assertIn('retry_auto  yes', output)
        self.assertIn('EVENT: MESSAGE_COMPLETED', output)

    def test_lifecycle_title_prefers_context_parse_mode(self) -> None:
        trace_id = 'trace-overview-title'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-overview',
            roadmap_id='roadmap-overview',
            message='Tell me all the features in this roadmap',
        )
        logging_utils.log_event(
            self.logger,
            'intent_classified',
            settings=self.settings_pretty,
            trace_id=trace_id,
            intent_type='unclear',
            parse_mode='heuristic_prerouter',
        )
        logging_utils.log_event(
            self.logger,
            'context_overview',
            settings=self.settings_pretty,
            trace_id=trace_id,
            parse_mode='context_overview',
        )
        logging_utils.log_event(
            self.logger,
            'message_completed',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-overview',
            roadmap_id='roadmap-overview',
            intent_type='unclear',
            parse_mode='context_overview',
            provider_used='rule_based',
        )
        output = self.stream.getvalue()
        self.assertIn('AI REQUEST: ROADMAP OVERVIEW', output)
        self.assertNotIn('AI REQUEST: UNCLEAR', output)

    def test_lifecycle_block_keeps_redaction_and_preview_policy(self) -> None:
        trace_id = 'trace-redaction'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-redaction',
            roadmap_id='roadmap-redaction',
            message='x' * 600,
        )
        logging_utils.log_event(
            self.logger,
            'tool_call_requested',
            settings=self.settings_pretty,
            trace_id=trace_id,
            tool_name='search_nodes',
            tool_args={'query': 'platform', 'api_key': 'super-secret'},
        )
        logging_utils.log_event(
            self.logger,
            'message_completed',
            settings=self.settings_pretty,
            trace_id=trace_id,
            session_id='session-redaction',
            roadmap_id='roadmap-redaction',
            assistant_message='y' * 550,
            provider_used='rule_based',
        )
        output = self.stream.getvalue()
        self.assertNotIn('super-secret', output)
        self.assertIn('[REDACTED]', output)
        self.assertIn('(len=600)', output)
        self.assertIn('(len=550)', output)

    def test_json_mode_remains_json_only(self) -> None:
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings_json,
            trace_id='trace-json',
            session_id='session-json',
            roadmap_id='roadmap-json',
            message='hello',
        )
        raw = self.stream.getvalue().strip()
        parsed = json.loads(raw)
        self.assertEqual(parsed['event'], 'message_received')
        self.assertNotIn('AI REQUEST:', raw)
        self.assertNotIn('\x1b[', raw)

    def test_pretty_mode_tty_auto_colors_headers_only(self) -> None:
        stream = _TTYStringIO(tty=True)
        logger = logging.getLogger(f'logging-utils-tests-tty-auto-{id(self)}')
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)
        settings = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='auto',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )

        logging_utils.log_event(
            logger,
            'message_received',
            settings=settings,
            trace_id='trace-color-auto',
            session_id='session-color-auto',
            roadmap_id='roadmap-color-auto',
            message='Hello',
        )
        output = stream.getvalue()
        self.assertIn('\x1b[', output)
        self.assertIn('EVENT: MESSAGE_RECEIVED', output)
        self.assertIn('  session_id:', output)

    def test_pretty_mode_non_tty_auto_has_no_ansi(self) -> None:
        output = self._emit_minimal_lifecycle()
        self.assertNotIn('\x1b[', output)

    def test_pretty_mode_color_off_disables_ansi(self) -> None:
        stream = _TTYStringIO(tty=True)
        logger = logging.getLogger(f'logging-utils-tests-color-off-{id(self)}')
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)
        settings = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='off',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )
        logging_utils.log_event(
            logger,
            'message_received',
            settings=settings,
            trace_id='trace-color-off',
            session_id='session-color-off',
            roadmap_id='roadmap-color-off',
            message='Hello',
        )
        self.assertNotIn('\x1b[', stream.getvalue())

    def test_pretty_mode_color_on_forces_ansi(self) -> None:
        stream = _TTYStringIO(tty=False)
        logger = logging.getLogger(f'logging-utils-tests-color-on-{id(self)}')
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(handler)
        settings = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='on',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )
        logging_utils.log_event(
            logger,
            'message_received',
            settings=settings,
            trace_id='trace-color-on',
            session_id='session-color-on',
            roadmap_id='roadmap-color-on',
            message='Hello',
        )
        self.assertIn('\x1b[', stream.getvalue())

    def test_lifecycle_sections_have_single_blank_line_spacing(self) -> None:
        output = self._emit_minimal_lifecycle()
        self.assertIn('\nUSER\n', output)
        self.assertIn('\n\nACTOR\n', output)
        self.assertIn('\n\nROUTING\n', output)
        self.assertIn('\n\nTOOL CALL\n', output)
        self.assertIn('\n\nRESPONSE\n', output)
        self.assertIn('\n\nASSISTANT\n', output)

    def test_lifecycle_response_includes_react_terminal_and_loop_fields(self) -> None:
        output = self._emit_minimal_lifecycle()
        self.assertIn('stop        ready_to_stage', output)
        self.assertIn('action      execute', output)
        self.assertIn('react_loop  turns=2 budget=3 end=terminal', output)


class LoggingUtilsProgressTraceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stream = _TTYStringIO(tty=False)
        self.logger = logging.getLogger(f'logging-utils-progress-tests-{id(self)}')
        self.logger.handlers.clear()
        self.logger.propagate = False
        self.logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(self.stream)
        handler.setFormatter(logging.Formatter('%(message)s'))
        self.logger.addHandler(handler)
        logging_utils._LIFECYCLE_TRACES.clear()
        logging_utils._PROGRESS_TRACES.clear()
        self.settings = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='off',
            agent_log_include_content=False,
            agent_progress_events_enabled=True,
            agent_progress_events_allow_verbose=True,
        )

    def test_progress_trace_seq_and_completion_state(self) -> None:
        trace_id = 'trace-progress-seq'
        session_id = 'session-progress-seq'

        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-seq',
            message='Assign to me all roadmap tasks',
        )
        logging_utils.log_event(
            self.logger,
            'tool_call_requested',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-seq',
            tool_name='bulk_update_tasks_by_filter',
            tool_args={'status': 'all'},
            arg_keys=['status'],
        )
        logging_utils.log_event(
            self.logger,
            'message_completed',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-seq',
            response_mode='edit_plan',
            elapsed_ms=2000,
            auto_commit_async_enqueued=True,
        )

        first = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            after_seq=0,
            limit=50,
            detail='verbose',
            settings=self.settings,
        )
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual([event['seq'] for event in first['events']], [1, 2, 3])
        self.assertEqual(first['next_seq'], 3)
        self.assertFalse(first['done'])

        logging_utils.log_event(
            self.logger,
            'auto_commit_async_completed',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-seq',
            auto_commit_ms=5104,
            impacted_item_count=2,
            impacted_summary={'created': 1, 'modified': 1, 'deleted': 0},
            impacted_items=[
                {
                    'node_id': 'feat-1',
                    'node_type': 'feature',
                    'title': 'Checkout flow',
                    'impact': 'created',
                    'change_type': 'NODE_ADDED',
                },
                {
                    'node_id': 'task-1',
                    'node_type': 'task',
                    'title': 'Write tests',
                    'impact': 'modified',
                    'change_type': 'STATUS_CHANGED',
                },
            ],
        )

        second = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            after_seq=3,
            limit=50,
            detail='verbose',
            settings=self.settings,
        )
        self.assertIsNotNone(second)
        assert second is not None
        self.assertEqual([event['seq'] for event in second['events']], [4])
        self.assertTrue(second['done'])
        self.assertIsInstance(second.get('elapsed_ms'), int)
        details = second['events'][0].get('details')
        self.assertIsInstance(details, dict)
        assert isinstance(details, dict)
        self.assertEqual(details.get('impacted_item_count'), 2)
        self.assertIsInstance(details.get('impacted_items'), list)

    def test_rejected_terminal_tool_exposes_safe_counts_and_reason(self) -> None:
        trace_id = 'trace-progress-empty-action'
        session_id = 'session-progress-empty-action'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-empty-action',
            message='Create the roadmap',
        )

        progress.tool_rejected(
            self.settings,
            trace_id,
            'plan_roadmap_operations',
            reason='empty_action_payload',
            operations_count=0,
            revision_operations_count=0,
            clarifier_options_count=0,
            assistant_message_present=False,
        )

        response = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            detail='structured',
            settings=self.settings,
        )
        self.assertIsNotNone(response)
        assert response is not None
        rejected = response['events'][-1]
        self.assertEqual(rejected['event'], 'tool_call_result')
        self.assertEqual(rejected['status'], 'error')
        details = rejected['details']
        self.assertEqual(details['tool_error_code'], 'INVALID_OPERATIONS')
        self.assertEqual(
            details['result_summary'],
            {
                'assistant_message_present': False,
                'clarifier_options_count': 0,
                'operations_count': 0,
                'reason': 'empty_action_payload',
                'revision_operations_count': 0,
            },
        )

    def test_progress_trace_ttl_eviction(self) -> None:
        trace_id = 'trace-progress-ttl'
        session_id = 'session-progress-ttl'
        logging_utils.log_event(
            self.logger,
            'message_received',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-ttl',
            message='hello',
        )
        trace = logging_utils._PROGRESS_TRACES[trace_id]
        trace.last_seen_monotonic = (
            trace.last_seen_monotonic - logging_utils._PROGRESS_EVENT_TRACE_TTL_SECONDS - 1.0
        )

        fetched = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            settings=self.settings,
        )
        self.assertIsNone(fetched)

    def test_structured_detail_mode_redacts_verbose_fields(self) -> None:
        trace_id = 'trace-progress-structured'
        session_id = 'session-progress-structured'
        logging_utils.log_event(
            self.logger,
            'tool_call_requested',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-structured',
            tool_name='resolve_node_reference',
            arg_keys=['label', 'limit'],
            tool_args={'label': 'Platform Foundation', 'limit': 5, 'roadmap_id': 'x'},
        )

        structured = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            detail='structured',
            settings=self.settings,
        )
        self.assertIsNotNone(structured)
        assert structured is not None
        details = structured['events'][0].get('details')
        self.assertIsInstance(details, dict)
        assert isinstance(details, dict)
        self.assertEqual(set(details.keys()), {'arg_keys', 'tool_args', 'tool_name'})

    def test_structured_planner_summary_exposes_summary_fields(self) -> None:
        trace_id = 'trace-progress-planner-summary'
        session_id = 'session-progress-planner-summary'
        summary_text = (
            'I reviewed roadmap context and prepared three safe updates for staging.'
        )
        logging_utils.log_event(
            self.logger,
            'planner_summary',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-planner-summary',
            response_mode='edit_plan',
            summary_text=summary_text,
            summary_source='model_assistant_message',
            operations_count=3,
            operation_types=['update_node', 'mark_status', 'mark_status'],
        )

        structured = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            detail='structured',
            settings=self.settings,
        )
        self.assertIsNotNone(structured)
        assert structured is not None
        self.assertEqual(len(structured['events']), 1)
        event = structured['events'][0]
        self.assertEqual(event.get('event'), 'planner_summary')
        self.assertEqual(event.get('title'), 'Planner summary')
        self.assertEqual(event.get('status'), 'success')
        self.assertEqual(event.get('summary'), summary_text)
        details = event.get('details')
        self.assertIsInstance(details, dict)
        assert isinstance(details, dict)
        self.assertEqual(details.get('summary_source'), 'model_assistant_message')
        self.assertEqual(details.get('response_mode'), 'edit_plan')
        self.assertEqual(details.get('operations_count'), 3)

    def test_summarize_tool_result_includes_capped_title_list_metadata(self) -> None:
        result = {
            'tasks': [
                {'id': f't-{index}', 'title': f'Task {index}'}
                for index in range(1, 61)
            ],
        }
        summary = logging_utils.summarize_tool_result(result)
        self.assertEqual(summary.get('tasks_count'), 60)
        item_titles = summary.get('item_titles')
        self.assertIsInstance(item_titles, list)
        assert isinstance(item_titles, list)
        self.assertEqual(len(item_titles), 50)
        self.assertEqual(summary.get('item_titles_shown_count'), 50)
        self.assertEqual(summary.get('item_titles_total_count'), 60)
        self.assertTrue(summary.get('item_titles_has_more'))

    def test_structured_auto_commit_failed_exposes_invalid_operation_snapshot(self) -> None:
        trace_id = 'trace-progress-auto-commit-invalid'
        session_id = 'session-progress-auto-commit-invalid'
        logging_utils.log_event(
            self.logger,
            'auto_commit_async_failed',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-auto-commit-invalid',
            auto_commit_error_message='Commit has validation errors and cannot be applied',
            auto_commit_error_upstream_status=400,
            auto_commit_invalid_operation={
                'index': 0,
                'reason': 'mark_status.status_invalid',
            },
        )

        structured = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            detail='structured',
            settings=self.settings,
        )
        self.assertIsNotNone(structured)
        assert structured is not None
        details = structured['events'][0].get('details')
        self.assertIsInstance(details, dict)
        assert isinstance(details, dict)
        self.assertEqual(details.get('auto_commit_error_upstream_status'), 400)
        self.assertIsInstance(details.get('auto_commit_invalid_operation'), dict)

    def test_structured_auto_commit_completed_exposes_impacted_items(self) -> None:
        trace_id = 'trace-progress-auto-commit-completed'
        session_id = 'session-progress-auto-commit-completed'
        logging_utils.log_event(
            self.logger,
            'auto_commit_async_completed',
            settings=self.settings,
            trace_id=trace_id,
            session_id=session_id,
            roadmap_id='roadmap-progress-auto-commit-completed',
            auto_commit_ms=1240,
            impacted_item_count=1,
            impacted_summary={'created': 1, 'modified': 0, 'deleted': 0},
            impacted_items=[
                {
                    'node_id': 'epic-1',
                    'node_type': 'epic',
                    'title': 'Authentication',
                    'impact': 'created',
                    'change_type': 'NODE_ADDED',
                }
            ],
        )

        structured = logging_utils.get_progress_trace_events(
            session_id=session_id,
            trace_id=trace_id,
            detail='structured',
            settings=self.settings,
        )
        self.assertIsNotNone(structured)
        assert structured is not None
        details = structured['events'][0].get('details')
        self.assertIsInstance(details, dict)
        assert isinstance(details, dict)
        self.assertEqual(details.get('impacted_item_count'), 1)
        self.assertIsInstance(details.get('impacted_summary'), dict)
        self.assertIsInstance(details.get('impacted_items'), list)


if __name__ == '__main__':
    unittest.main()

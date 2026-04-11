import io
import json
import logging
import unittest
from types import SimpleNamespace

from app.core import logging_utils


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
        self.settings_pretty = SimpleNamespace(
            agent_log_json=False,
            agent_log_color='auto',
            agent_log_include_content=False,
        )
        self.settings_json = SimpleNamespace(
            agent_log_json=True,
            agent_log_color='auto',
            agent_log_include_content=False,
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


if __name__ == '__main__':
    unittest.main()

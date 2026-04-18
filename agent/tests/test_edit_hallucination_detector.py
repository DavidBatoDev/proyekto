"""Hallucination observability: `edit_planner_staged_op_with_unverified_value`.

This event fires when the edit planner stages an operation whose freeform
value (title, description) doesn't appear anywhere the user could have
said it — not in the current message, the pending edit context, or recent
session history. Non-blocking; the metric validates whether the tool
schema + prompt guardrails are sufficient now that the vague-value
preflight has been removed.
"""

from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from typing import Any

from app.core.contracts.operations import (
    NodeType,
    OperationType,
    RoadmapOperation,
)
from app.core.contracts.sessions import AgentSession, PendingEditContext, Message
from app.core.orchestration.planning_orchestrator import _detect_unverified_values


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        agent_log_include_content=False,
        agent_log_json=False,
        agent_progress_events_enabled=False,
        agent_progress_events_allow_verbose=False,
    )


def _planning(operations: list[RoadmapOperation]) -> SimpleNamespace:
    return SimpleNamespace(
        operations=operations,
        response_mode='edit_plan',
    )


def _capturing_logger() -> tuple[logging.Logger, list[logging.LogRecord]]:
    records: list[logging.LogRecord] = []
    logger = logging.getLogger('test_edit_hallucination_detector')
    logger.handlers.clear()
    logger.setLevel(logging.INFO)

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    logger.addHandler(_Capture())
    logger.propagate = False
    return logger, records


def _rename_op(title: str, node_id: str = 'epic-uuid') -> RoadmapOperation:
    return RoadmapOperation(
        op=OperationType.UPDATE_NODE,
        node_id=node_id,
        node_type=NodeType.EPIC,
        patch={'title': title},
    )


def _create_epic_op(title: str) -> RoadmapOperation:
    return RoadmapOperation(
        op=OperationType.ADD_EPIC,
        data={'title': title},
    )


class DetectUnverifiedValuesTests(unittest.TestCase):
    def test_no_event_when_value_appears_in_user_message(self) -> None:
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([_rename_op('Career Launch')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename the last epic to "Career Launch"',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_no_event_when_value_matches_clarifier_answer_on_pending(self) -> None:
        # Simulates the turn-2 clarifier-answer replay path: raw user
        # message is a sentinel JSON, but the picked value lives on
        # pending_edit_context.default_title.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        session.metadata.pending_edit_context = PendingEditContext(
            intent_family='rename_node',
            source_user_message='Rename my last epic to something',
            default_title='Career Launch',
            awaiting_field='rename_title',
        )
        planning = _planning([_rename_op('Career Launch')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='__clarifier_answer__ {"lane":"edit","selected_option":"Career Launch"}',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_event_fires_when_value_is_fabricated(self) -> None:
        # User said "something", planner invented "Mystery Enterprise".
        # Neither in user_message nor pending — classic hallucination.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([_rename_op('Mystery Enterprise')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename my last epic to something',
            logger=logger,
            settings=_settings(),
            trace_id='trace-hallucination',
        )
        self.assertEqual(len(records), 1)
        message = records[0].getMessage()
        self.assertIn('edit_planner_staged_op_with_unverified_value', message.lower())
        self.assertIn('Mystery Enterprise', message)

    def test_no_event_for_status_enum_values(self) -> None:
        # "mark it done" → patch.status='done'. Status enums are semantic
        # and legitimately emitted by the planner from a keyword mention.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        op = RoadmapOperation(
            op=OperationType.UPDATE_NODE,
            node_id='task-uuid',
            node_type=NodeType.TASK,
            patch={'status': 'done'},
        )
        planning = _planning([op])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='mark it',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_no_event_for_non_edit_plan_response_modes(self) -> None:
        # Plan proposal, chat, query — detector should no-op. Only
        # edit_plan operations risk staging hallucinations.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = SimpleNamespace(
            operations=[_rename_op('Mystery Enterprise')],
            response_mode='plan_proposal',
        )
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='plan something',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_case_and_quote_insensitive_match(self) -> None:
        # User typed "rename to Career Launch" (no quotes); planner
        # staged `"Career Launch"` (with quotes). Match both ways.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([_rename_op('"Career Launch"')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename the last epic to Career Launch',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_no_event_when_value_appears_in_recent_session_history(self) -> None:
        # User asked for "Career Launch" 3 turns ago; planner now stages
        # it. Still verified via session.messages.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        session.messages = [
            Message(role='user', content='hi'),
            Message(role='assistant', content='hello'),
            Message(role='user', content='Rename the last epic to Career Launch'),
            Message(role='assistant', content='working on it'),
            Message(role='user', content='yes proceed'),
        ]
        planning = _planning([_rename_op('Career Launch')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='yes proceed',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_no_event_for_empty_operations(self) -> None:
        # Clarifier turn: operations=[] and assistant_message is a
        # question. Detector must no-op.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename my last epic',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_short_fabricated_values_are_ignored(self) -> None:
        # A staged title "XY" is below the min length threshold; too
        # noisy to treat as a hallucination signal. The detector skips.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([_rename_op('XY')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename my last epic',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_staged_value_verified_via_prior_tool_message(self) -> None:
        """Tool-result content in a prior `role='tool'` message counts as
        ground-truth the LLM can legitimately stage against. The title
        "Career Launch" was returned by a resolver in turn 1; staging it
        in turn 2 should not trigger the unverified event even though
        the user's current message is a clarifier sentinel that doesn't
        contain the string.
        """
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        session.messages = [
            Message(role='user', content='rename my last epic'),
            Message(
                role='assistant',
                content='',
                tool_calls=[{
                    'id': 'call_1',
                    'name': 'resolve_node_reference',
                    'args': {'label': 'last epic'},
                }],
            ),
            Message(
                role='tool',
                content='{"matches":[{"id":"epic-x","title":"Career Launch"}]}',
                tool_call_id='call_1',
            ),
        ]
        planning = _planning([_rename_op('Career Launch')])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='__clarifier_answer__ {"selected_option":"Career Launch"}',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(records, [])

    def test_multiple_operations_one_unverified(self) -> None:
        # Two ops staged; one title matches user input, the other is
        # fabricated. Event fires with unverified_count=1.
        session = AgentSession(roadmap_id='roadmap-1', base_revision=3)
        planning = _planning([
            _rename_op('Career Launch', node_id='epic-1'),
            _create_epic_op('Mystery Vertical'),
        ])
        logger, records = _capturing_logger()
        _detect_unverified_values(
            planning=planning,
            session=session,
            user_message='Rename the last epic to Career Launch',
            logger=logger,
            settings=_settings(),
            trace_id=None,
        )
        self.assertEqual(len(records), 1)
        message = records[0].getMessage()
        self.assertIn('Mystery Vertical', message)
        self.assertNotIn('Career Launch', message)


if __name__ == '__main__':
    unittest.main()

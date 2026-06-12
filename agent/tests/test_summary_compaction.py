"""Conversation compaction: trigger threshold, candidate apply with
fingerprint validation, mismatch discard (e.g. rehydrated sessions), and
message truncation."""

import unittest

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession, Message
from app.core.v2.summarizer import (
    _message_fingerprint,
    apply_pending_compaction,
    should_schedule_compaction,
)


def _settings(**overrides):
    base = {
        'agent_summary_trigger_messages': 8,
        'agent_summary_keep_messages': 6,
        'agent_summary_max_chars': 4000,
    }
    base.update(overrides)
    return get_settings().model_copy(update=base)


def _session_with_messages(count: int) -> AgentSession:
    session = AgentSession(roadmap_id='roadmap-compact')
    for index in range(count):
        role = 'user' if index % 2 == 0 else 'assistant'
        session.messages.append(Message(role=role, content=f'turn {index}'))
    return session


class _FakeStore:
    def __init__(self, candidate=None):
        self.candidate = candidate
        self.deleted = False

    def get_summary_candidate(self, _session_id):
        return self.candidate

    def delete_summary_candidate(self, _session_id):
        self.deleted = True


def _candidate_for(session: AgentSession, fold_count: int, summary='The early talk.'):
    return {
        'summary': summary,
        'fold_count': fold_count,
        'first_fp': _message_fingerprint(session.messages[0]),
        'last_fp': _message_fingerprint(session.messages[fold_count - 1]),
    }


class CompactionTests(unittest.TestCase):
    def test_trigger_threshold(self) -> None:
        self.assertFalse(
            should_schedule_compaction(_session_with_messages(8), _settings())
        )
        self.assertTrue(
            should_schedule_compaction(_session_with_messages(9), _settings())
        )

    def test_apply_folds_and_truncates(self) -> None:
        session = _session_with_messages(12)
        store = _FakeStore(_candidate_for(session, fold_count=6))

        applied = apply_pending_compaction(store, session, _settings())

        self.assertTrue(applied)
        self.assertEqual(len(session.messages), 6)
        self.assertEqual(session.messages[0].content, 'turn 6')
        self.assertEqual(session.metadata.conversation_summary, 'The early talk.')
        self.assertEqual(session.metadata.conversation_summary_folded_count, 6)
        self.assertTrue(store.deleted)

    def test_fingerprint_mismatch_discards(self) -> None:
        session = _session_with_messages(12)
        candidate = _candidate_for(session, fold_count=6)
        # Simulate a rehydrated session whose seeded prefix differs.
        session.messages[0] = Message(role='user', content='different history')
        store = _FakeStore(candidate)

        applied = apply_pending_compaction(store, session, _settings())

        self.assertFalse(applied)
        self.assertEqual(len(session.messages), 12)
        self.assertIsNone(session.metadata.conversation_summary)
        self.assertTrue(store.deleted)

    def test_short_session_discards_stale_candidate(self) -> None:
        session = _session_with_messages(3)
        store = _FakeStore(
            {
                'summary': 'stale',
                'fold_count': 6,
                'first_fp': 'x',
                'last_fp': 'y',
            }
        )

        applied = apply_pending_compaction(store, session, _settings())

        self.assertFalse(applied)
        self.assertTrue(store.deleted)

    def test_no_candidate_is_noop(self) -> None:
        session = _session_with_messages(12)
        applied = apply_pending_compaction(_FakeStore(None), session, _settings())
        self.assertFalse(applied)
        self.assertEqual(len(session.messages), 12)


if __name__ == '__main__':
    unittest.main()

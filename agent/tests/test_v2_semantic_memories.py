"""Semantic memory retrieval: grouped/tagged rendering of memory notes,
threshold-gated per-turn top-k fetch, tail-block placement (prompt-cache
prefix stays stable), and silent fallback to inject-all on failure."""

from __future__ import annotations

import unittest

from app.core.config import get_settings
from app.core.contracts.sessions import AgentSession
from app.core.v2.brain import _apply_semantic_memory_retrieval
from app.core.v2.context import compact_state


def _settings(**updates):
    return get_settings().model_copy(
        update={'agent_memory_semantic_threshold': 15, **updates}
    )


def _session() -> AgentSession:
    return AgentSession(roadmap_id='22222222-2222-2222-2222-222222222222')


def _note(i: int, scope: str = 'roadmap', category: str = 'preference') -> dict:
    return {
        'id': f'mem-{i}',
        'content': f'Note number {i}',
        'source': 'user_request',
        'scope': scope,
        'category': category,
    }


class GroupedRenderTests(unittest.TestCase):
    def test_notes_group_by_scope_and_tag_categories(self) -> None:
        state = compact_state(
            _session(),
            {
                'memory_notes': [
                    _note(1, scope='project', category='decision'),
                    _note(2, scope='roadmap', category='fact'),
                    _note(3, scope='roadmap'),
                ],
            },
        )
        self.assertIn('# Memory notes (durable preferences for this roadmap)', state)
        self.assertIn('Project-wide:', state)
        self.assertIn('This roadmap:', state)
        self.assertIn('[decision] "Note number 1"', state)
        self.assertIn('[fact] "Note number 2"', state)
        # Plain preferences carry no category tag.
        self.assertIn('- "Note number 3"', state)
        self.assertLess(state.index('Project-wide:'), state.index('This roadmap:'))

    def test_roadmap_only_notes_keep_flat_list(self) -> None:
        state = compact_state(
            _session(),
            {'memory_notes': [_note(1), _note(2)]},
        )
        self.assertNotIn('Project-wide:', state)
        self.assertNotIn('This roadmap:', state)
        self.assertIn('- "Note number 1"', state)


class TailBlockTests(unittest.TestCase):
    def test_semantic_mode_renders_stub_and_tail_block_last(self) -> None:
        state = compact_state(
            _session(),
            {
                'roadmap_overview_summary': 'Roadmap: Apollo',
                'memory_notes': [_note(i) for i in range(20)],
                'memory_notes_semantic': True,
                'relevant_memory_notes': [
                    _note(3, scope='project', category='decision')
                ],
                'roadmap_role': 'owner',
            },
        )
        tail_header = '# Relevant memories (semantically matched to this message)'
        self.assertIn('# Memory notes\n(20 stored;', state)
        self.assertIn(tail_header, state)
        self.assertIn('[decision] "Note number 3"', state)
        # The tail block MUST come after # Actor so per-turn churn only costs
        # the prompt suffix. (The stub mentions "# Relevant memories" inside a
        # parenthetical, so match the full tail header.)
        self.assertLess(state.index('# Actor'), state.index(tail_header))
        self.assertTrue(
            state.rstrip().splitlines()[-1].startswith('- [decision] "Note number 3"')
        )
        # The full note list must NOT also render in the prefix.
        self.assertNotIn('# Memory notes (durable preferences', state)

    def test_below_threshold_is_byte_identical_to_inject_all(self) -> None:
        context = {
            'roadmap_overview_summary': 'Roadmap: Apollo',
            'memory_notes': [_note(i) for i in range(3)],
            'roadmap_role': 'owner',
        }
        without_flag = compact_state(_session(), dict(context))
        # memory_notes_semantic unset/false renders exactly the same.
        with_false_flag = compact_state(
            _session(), {**context, 'memory_notes_semantic': False}
        )
        self.assertEqual(without_flag, with_false_flag)
        self.assertNotIn('# Relevant memories', without_flag)


class _RelevantNest:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload if payload is not None else {
            'memories': [_note(1, scope='project')]
        }
        self.error = error
        self.calls: list[dict] = []

    async def ai_memories_relevant(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.payload


class _FakeService:
    """Just enough of AgentService for _apply_semantic_memory_retrieval."""

    def __init__(self, nest, settings):
        self._nest_client = nest
        self._settings = settings

    def _run_async_call(self, coro):
        import asyncio

        return asyncio.run(coro)


class RetrievalGateTests(unittest.TestCase):
    def test_at_or_below_threshold_skips_fetch(self) -> None:
        nest = _RelevantNest()
        service = _FakeService(nest, _settings(agent_memory_semantic_threshold=15))
        context = {'memory_notes': [_note(i) for i in range(15)]}
        _apply_semantic_memory_retrieval(
            service=service,
            session=_session(),
            session_context=context,
            user_message='what did we decide?',
            auth_header='Bearer t',
            trace_id=None,
        )
        self.assertEqual(nest.calls, [])
        self.assertNotIn('memory_notes_semantic', context)

    def test_above_threshold_fetches_and_sets_context(self) -> None:
        nest = _RelevantNest()
        service = _FakeService(nest, _settings(agent_memory_semantic_threshold=15))
        context = {'memory_notes': [_note(i) for i in range(16)]}
        _apply_semantic_memory_retrieval(
            service=service,
            session=_session(),
            session_context=context,
            user_message='x' * 900,
            auth_header='Bearer t',
            trace_id=None,
        )
        self.assertTrue(context.get('memory_notes_semantic'))
        self.assertEqual(len(context['relevant_memory_notes']), 1)
        call = nest.calls[0]
        self.assertEqual(len(call['query']), 500)  # query capped
        self.assertEqual(call['limit'], 8)

    def test_fetch_failure_falls_back_to_inject_all(self) -> None:
        nest = _RelevantNest(error=RuntimeError('backend down'))
        service = _FakeService(nest, _settings(agent_memory_semantic_threshold=1))
        context = {'memory_notes': [_note(i) for i in range(5)]}
        _apply_semantic_memory_retrieval(
            service=service,
            session=_session(),
            session_context=context,
            user_message='hello there',
            auth_header='Bearer t',
            trace_id=None,
        )
        self.assertNotIn('memory_notes_semantic', context)
        self.assertNotIn('relevant_memory_notes', context)

    def test_empty_match_falls_back_to_inject_all(self) -> None:
        nest = _RelevantNest(payload={'memories': []})
        service = _FakeService(nest, _settings(agent_memory_semantic_threshold=1))
        context = {'memory_notes': [_note(i) for i in range(5)]}
        _apply_semantic_memory_retrieval(
            service=service,
            session=_session(),
            session_context=context,
            user_message='hello there',
            auth_header='Bearer t',
            trace_id=None,
        )
        self.assertNotIn('memory_notes_semantic', context)


if __name__ == '__main__':
    unittest.main()

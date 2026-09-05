"""The revert_changes terminal tool: classification + exposure, and the loop
turning a revert call into a deterministic edit (or a chat reply when there's
nothing to undo)."""

import json
import unittest

from app.core.config import get_settings
from app.core.contracts.sessions import AppliedChange, ChangeGroup
from app.core.runtime import revert
from app.core.runtime import tools as tools_spec
from app.core.engine.loop import run_loop
from app.core.engine.llm_client import LLMResponse, ToolCall

ROADMAP = 'roadmap-root'


def _revert_resp(args):
    return LLMResponse(
        content=None,
        tool_calls=[
            ToolCall(
                id='call_revert',
                name='revert_changes',
                arguments=args,
                raw_arguments=json.dumps(args),
            )
        ],
    )


class _ScriptedClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.call_count = 0

    def complete(self, messages, tools):
        self.call_count += 1
        return self._responses.pop(0)


def _removed(node_id, node_type, parent_id, title):
    snap = {'id': node_id, 'type': node_type, 'title': title}
    if parent_id is not None:
        snap['parentId'] = parent_id
    return AppliedChange(
        node_id=node_id, node_type=node_type, change_type='NODE_REMOVED',
        change_from=snap, change_to={}, title=title,
    )


def _cascade_group(change_id):
    return ChangeGroup(change_id=change_id, summary='Deleted 1 epic, 1 feature, 1 task', changes=[
        _removed('epic-1', 'epic', ROADMAP, 'Epic 1'),
        _removed('feat-1', 'feature', 'epic-1', 'Feature 1'),
        _removed('task-1', 'task', 'feat-1', 'Task 1'),
    ])


def _history_dicts(*groups):
    return [g.model_dump(mode='json', exclude_none=True) for g in groups]


def _run(args, change_history):
    client = _ScriptedClient([_revert_resp(args)])
    return run_loop(
        client=client,
        messages=[{'role': 'system', 'content': 'sys'},
                  {'role': 'user', 'content': 'revert it'}],
        tools=[],
        dispatcher=None,
        session_context={'roadmap_id': ROADMAP, 'change_history': change_history},
        handle_map={},
        settings=get_settings(),
        trace_id=None,
    )


class ClassificationTests(unittest.TestCase):
    def test_revert_is_terminal_not_dispatcher(self) -> None:
        self.assertTrue(tools_spec.is_terminal_tool('revert_changes'))
        self.assertFalse(tools_spec.is_dispatcher_tool('revert_changes'))

    def test_build_tools_exposes_revert(self) -> None:
        names = {t['function']['name'] for t in tools_spec.build_tools()}
        self.assertIn('revert_changes', names)

    def test_revert_schema_accepts_roadmap_id(self) -> None:
        spec = tools_spec.revert_changes_tool()
        props = spec['function']['parameters']['properties']
        self.assertIn('change_id', props)
        self.assertIn('roadmap_id', props)
        self.assertEqual(spec['function']['parameters']['required'], [])


class SelectRevertRangeRoadmapFilterTests(unittest.TestCase):
    """A revert is one commit on one roadmap: the range is picked from that
    roadmap's history only. Groups recorded before roadmaps were tracked
    (roadmap_id=None) stay revertible from any scope."""

    def _history(self):
        alpha_new = _cascade_group('alpha-2')
        alpha_new.roadmap_id = 'alpha'
        beta = _cascade_group('beta-1')
        beta.roadmap_id = 'beta'
        alpha_old = _cascade_group('alpha-1')
        alpha_old.roadmap_id = 'alpha'
        legacy = _cascade_group('legacy-0')
        return [alpha_new, beta, alpha_old, legacy]

    def test_latest_is_scoped_to_the_roadmap(self) -> None:
        selected = revert.select_revert_range(self._history(), None, roadmap_id='beta')
        self.assertEqual([g.change_id for g in selected], ['beta-1'])

    def test_change_id_range_skips_other_roadmaps(self) -> None:
        selected = revert.select_revert_range(self._history(), 'alpha-1', roadmap_id='alpha')
        self.assertEqual([g.change_id for g in selected], ['alpha-2', 'alpha-1'])

    def test_legacy_groups_without_roadmap_stay_in_every_scope(self) -> None:
        selected = revert.select_revert_range(self._history(), 'legacy-0', roadmap_id='beta')
        self.assertEqual([g.change_id for g in selected], ['beta-1', 'legacy-0'])

    def test_no_roadmap_filter_keeps_the_whole_history(self) -> None:
        selected = revert.select_revert_range(self._history(), 'alpha-1')
        self.assertEqual([g.change_id for g in selected], ['alpha-2', 'beta-1', 'alpha-1'])

    def test_unknown_roadmap_yields_empty(self) -> None:
        history = [g for g in self._history() if g.roadmap_id]
        self.assertEqual(revert.select_revert_range(history, None, roadmap_id='gamma'), [])

    def test_roadmap_ids_with_history_are_most_recent_first(self) -> None:
        self.assertEqual(revert.roadmap_ids_with_history(self._history()), ['alpha', 'beta'])


class RevertLoopTests(unittest.TestCase):
    def test_revert_last_change_stages_edit(self) -> None:
        result = _run({}, _history_dicts(_cascade_group('chg-1')))
        self.assertEqual(result.kind, 'revert')
        self.assertEqual(result.terminal_tool, 'revert_changes')
        self.assertEqual([b.source for b in result.batches], ['revert'])
        self.assertEqual(result.batches[0].roadmap_id, ROADMAP)
        op_names = [getattr(o.op, 'value', str(o.op)) for o in result.operations]
        self.assertEqual(op_names.count('add_epic'), 1)
        self.assertEqual(op_names.count('add_feature'), 1)
        self.assertEqual(op_names.count('add_task'), 1)

    def test_revert_to_change_id_spans_range(self) -> None:
        # Two delete groups; revert back to the older one undoes both.
        history = _history_dicts(_cascade_group('chg-2'), _cascade_group('chg-1'))
        result = _run({'change_id': 'chg-1'}, history)
        self.assertEqual(result.kind, 'revert')
        # Both groups deleted the same ids → net one tree recreated (deduped).
        op_names = [getattr(o.op, 'value', str(o.op)) for o in result.operations]
        self.assertEqual(op_names.count('add_epic'), 1)

    def test_empty_history_replies_chat(self) -> None:
        result = _run({}, [])
        self.assertEqual(result.kind, 'chat')
        self.assertEqual(result.operations, [])

    def test_unknown_change_id_replies_chat(self) -> None:
        result = _run({'change_id': 'missing'}, _history_dicts(_cascade_group('chg-1')))
        self.assertEqual(result.kind, 'chat')


if __name__ == '__main__':
    unittest.main()

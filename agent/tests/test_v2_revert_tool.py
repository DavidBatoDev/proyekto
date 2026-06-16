"""The revert_changes terminal tool: classification + exposure, and the loop
turning a revert call into a deterministic edit (or a chat reply when there's
nothing to undo)."""

import json
import unittest

from app.core.config import get_settings
from app.core.contracts.sessions import AppliedChange, ChangeGroup
from app.core.v2 import tools_spec
from app.core.v2.loop import run_loop
from app.core.v2.openai_client import LLMResponse, ToolCall

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


class RevertLoopTests(unittest.TestCase):
    def test_revert_last_change_stages_edit(self) -> None:
        result = _run({}, _history_dicts(_cascade_group('chg-1')))
        self.assertEqual(result.kind, 'edit')
        self.assertEqual(result.terminal_tool, 'revert_changes')
        op_names = [getattr(o.op, 'value', str(o.op)) for o in result.operations]
        self.assertEqual(op_names.count('add_epic'), 1)
        self.assertEqual(op_names.count('add_feature'), 1)
        self.assertEqual(op_names.count('add_task'), 1)

    def test_revert_to_change_id_spans_range(self) -> None:
        # Two delete groups; revert back to the older one undoes both.
        history = _history_dicts(_cascade_group('chg-2'), _cascade_group('chg-1'))
        result = _run({'change_id': 'chg-1'}, history)
        self.assertEqual(result.kind, 'edit')
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

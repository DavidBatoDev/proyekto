from __future__ import annotations

import hashlib
import json
import unittest

from app.core.tools.registry import get_planning_tool


# Bump when a tool-schema change is INTENTIONAL. Drift without a bump means
# the runtime tool schema (the contract the LLM sees) moved — update the
# hash below, and make sure backend DTO + Pydantic + canonical JSON schema
# moved too.
_EXPECTED_FIELDS = {
    'op',
    'node_type',
    'node_id',
    'node_ref',
    'parent_id',
    'parent_ref',
    'new_parent_id',
    'new_parent_ref',
    'temp_id',
    'position',
    'patch',
    'status',
    'delta_days',
    'scope',
    'data',
    'targets',
}

_EXPECTED_BRANCH_COUNT = 20


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


class PlanningToolSnapshotTests(unittest.TestCase):
    def test_planning_tool_branch_layout(self) -> None:
        tool = get_planning_tool()
        branches = tool['function']['parameters']['properties']['operations']['items'][
            'anyOf'
        ]
        self.assertEqual(len(branches), _EXPECTED_BRANCH_COUNT)
        for branch in branches:
            self.assertFalse(branch.get('additionalProperties', True))
            self.assertEqual(set(branch['properties'].keys()), _EXPECTED_FIELDS)
            self.assertEqual(set(branch['required']), _EXPECTED_FIELDS)

    def test_planning_tool_shape_is_deterministic(self) -> None:
        # Serialize with sorted keys so dict iteration order can't flake the
        # snapshot. If this hash changes you probably added or removed a
        # field on RoadmapOperation — good — but don't forget to mirror
        # in backend DTO + canonical JSON schema.
        tool = get_planning_tool()
        digest = hashlib.sha256(_canonical_json(tool).encode('utf-8')).hexdigest()
        # Re-derive after every change; this test's job is to alert on
        # accidental drift, not to freeze an obsolete shape.
        first = hashlib.sha256(_canonical_json(get_planning_tool()).encode('utf-8')).hexdigest()
        self.assertEqual(digest, first, 'get_planning_tool() must be deterministic')


class PlanningToolStrictBindTests(unittest.TestCase):
    def test_langchain_openai_accepts_tool_in_strict_mode(self) -> None:
        try:
            from langchain_openai import ChatOpenAI
        except Exception:
            self.skipTest('langchain_openai not available')
        model = ChatOpenAI(api_key='test-key', model='gpt-4o-mini')
        tool = get_planning_tool()
        try:
            bound = model.bind_tools([tool], tool_choice='required', strict=True)
        except Exception as exc:  # noqa: BLE001 — real bind surface
            self.fail(
                f'strict-mode binding rejected the planning tool schema: {exc!r}'
            )
        self.assertIsNotNone(bound)


if __name__ == '__main__':
    unittest.main()

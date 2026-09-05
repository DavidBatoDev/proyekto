"""The per-phase / per-scope tool catalogs derived from the registry: which
tools each phase sees, where `roadmap_id` / `project_id` / `targets` are
required, pinned roadmap ids in the execute-phase loops, and the
classification sets the engine loop keys on. The registry's `required=`
literals are never edited (the backend schema gate greps them)."""

from __future__ import annotations

import copy
import unittest

from app.core.contracts.sessions import AgentSession, PendingPlan
from app.core.runtime import tools
from app.core.tools.handlers.workspace_query import PROJECT_KEYED_TOOL_NAMES, WORKSPACE_TOOL_NAMES
from app.core.tools.registry import CONTEXT_TOOL_NAMES, get_context_tools, get_planning_tool

ROADMAP = {'kind': 'roadmap', 'roadmap_id': '11111111-1111-1111-1111-111111111111'}
WORKSPACE = {'kind': 'workspace', 'workspace_id': 'ws-1'}
RID = '22222222-2222-2222-2222-222222222222'


def _names(specs):
    return [spec['function']['name'] for spec in specs]


def _by_name(specs):
    return {spec['function']['name']: spec['function'] for spec in specs}


class CatalogTests(unittest.TestCase):
    def test_investigate_catalog_contents(self) -> None:
        names = _names(tools.build_tools(scope=ROADMAP))
        # Every registry read with a schema (a few CONTEXT_TOOL_NAMES entries
        # are dispatchable but deliberately never exposed to the model).
        roadmap_reads = {
            spec['function']['name'] for spec in get_context_tools()
        } - PROJECT_KEYED_TOOL_NAMES - {'search_knowledge'}
        self.assertTrue(roadmap_reads.issubset(CONTEXT_TOOL_NAMES))
        for name in roadmap_reads:
            self.assertIn(name, names, name)
        for name in ('get_workspace_overview', 'list_roadmaps', 'search_everything', 'list_my_tasks'):
            self.assertIn(name, names)
        for name in PROJECT_KEYED_TOOL_NAMES:
            self.assertIn(name, names)
        for name in ('save_memory', 'forget_memory', 'add_task_comments'):
            self.assertIn(name, names)
        self.assertEqual(names[-4:], ['stage_edits', 'propose', 'ask_user', 'revert_changes'])
        self.assertNotIn('revise_proposal', names)
        self.assertNotIn('search_knowledge', names)
        self.assertNotIn('plan_roadmap_operations', names)
        self.assertNotIn('propose_plan', names)
        self.assertEqual(len(names), len(set(names)))

    def test_investigate_tools_derives_flags_from_the_session(self) -> None:
        session = AgentSession(scope=ROADMAP)
        self.assertNotIn('revise_proposal', _names(tools.investigate_tools(session)))
        session.metadata.pending_plan = PendingPlan(source_user_message='x')
        names = _names(tools.investigate_tools(session))
        self.assertIn('revise_proposal', names)
        self.assertLess(names.index('propose'), names.index('revise_proposal'))
        session.metadata.pending_plan.status = 'confirmed'
        self.assertNotIn('revise_proposal', _names(tools.investigate_tools(session)))
        self.assertIn('search_knowledge', _names(tools.investigate_tools(session, include_knowledge_search=True)))

    def test_materialize_tools_are_pinned_to_the_target_roadmap(self) -> None:
        session = AgentSession(scope=WORKSPACE)
        specs = _by_name(tools.materialize_tools(session, RID))
        self.assertIn('stage_edits', specs)
        self.assertNotIn('propose', specs)
        self.assertNotIn('ask_user', specs)
        self.assertNotIn('revert_changes', specs)
        self.assertNotIn('list_roadmaps', specs)
        self.assertNotIn('save_memory', specs)
        for name, fn in specs.items():
            props = fn['parameters']['properties']
            if 'roadmap_id' in props:
                self.assertEqual(props['roadmap_id']['enum'], [RID], name)
                self.assertNotIn('roadmap_id', fn['parameters']['required'], name)
        self.assertIn('search_nodes', specs)

    def test_repair_and_verify_catalogs(self) -> None:
        repair = tools.repair_tools(RID, WORKSPACE)
        self.assertEqual(_names(repair), ['stage_edits'])
        self.assertEqual(repair[0]['function']['parameters']['properties']['roadmap_id']['enum'], [RID])
        verify = tools.verify_tools(ROADMAP)
        self.assertEqual(_names(verify), ['propose'])
        self.assertIn('targets', verify[0]['function']['parameters']['required'])


class ScopeRequirementTests(unittest.TestCase):
    def test_roadmap_id_required_only_in_workspace_scope(self) -> None:
        roadmap_scope = _by_name(tools.roadmap_read_tools(ROADMAP))
        workspace_scope = _by_name(tools.roadmap_read_tools(WORKSPACE))
        self.assertTrue(roadmap_scope)
        for name, fn in roadmap_scope.items():
            self.assertIn('roadmap_id', fn['parameters']['properties'], name)
            self.assertNotIn('roadmap_id', fn['parameters']['required'], name)
            self.assertEqual(fn['parameters']['properties']['roadmap_id']['description'], tools.ROADMAP_ID_DESCRIPTION)
            self.assertIn('roadmap_id', workspace_scope[name]['parameters']['required'], name)
        self.assertIn('assigns it handles', roadmap_scope['get_roadmap_overview']['description'])
        self.assertIn('get_tasks_assigned_to_me', roadmap_scope)

    def test_registry_literals_are_untouched(self) -> None:
        before = copy.deepcopy(get_context_tools())
        tools.build_tools(scope=ROADMAP)
        tools.build_tools(scope=WORKSPACE)
        tools.materialize_tools(AgentSession(scope=WORKSPACE), RID)
        self.assertEqual(get_context_tools(), before)
        for spec in get_context_tools():
            params = spec['function']['parameters']
            if 'roadmap_id' in params['properties']:
                self.assertIn('roadmap_id', params['required'], spec['function']['name'])
        planning = get_planning_tool()['function']
        self.assertEqual(planning['name'], 'plan_roadmap_operations')
        self.assertIn('revision_operations', planning['parameters']['properties'])

    def test_project_id_required_only_in_workspace_scope(self) -> None:
        roadmap_scope = _by_name(tools.project_tools(ROADMAP))
        workspace_scope = _by_name(tools.project_tools(WORKSPACE))
        self.assertEqual(set(roadmap_scope), PROJECT_KEYED_TOOL_NAMES)
        for name in PROJECT_KEYED_TOOL_NAMES:
            self.assertNotIn('project_id', roadmap_scope[name]['parameters']['required'], name)
            self.assertIn('project_id', workspace_scope[name]['parameters']['required'], name)
        self.assertEqual(workspace_scope['get_member_details']['parameters']['required'], ['project_id', 'member_id'])

    def test_stage_edits_roadmap_id_per_scope(self) -> None:
        roadmap_scope = tools.stage_edits_tool(ROADMAP)['function']['parameters']
        workspace_scope = tools.stage_edits_tool(WORKSPACE)['function']['parameters']
        pinned = tools.stage_edits_tool(WORKSPACE, pinned_roadmap_id=RID)['function']['parameters']
        self.assertNotIn('roadmap_id', roadmap_scope['required'])
        self.assertIn('roadmap_id', workspace_scope['required'])
        self.assertNotIn('roadmap_id', pinned['required'])
        self.assertEqual(pinned['properties']['roadmap_id']['enum'], [RID])
        self.assertNotIn('revision_operations', roadmap_scope['properties'])
        self.assertEqual(roadmap_scope['properties']['operations']['minItems'], 1)
        description = tools.stage_edits_tool(ROADMAP)['function']['description']
        self.assertTrue(description.startswith('Stage concrete edits for ONE roadmap.'))
        self.assertNotIn('DUAL-TARGET CONTRACT', description)
        self.assertNotIn('CLARIFIER CONTRACT', description)
        self.assertNotIn('revision_operations', description)

    def test_propose_targets_per_scope(self) -> None:
        roadmap_scope = tools.propose_tool(ROADMAP)['function']['parameters']
        workspace_scope = tools.propose_tool(WORKSPACE)['function']['parameters']
        self.assertEqual(roadmap_scope['required'], ['summary', 'goal', 'proposed_hierarchy'])
        self.assertEqual(workspace_scope['required'], ['summary', 'goal', 'targets'])
        target = roadmap_scope['properties']['targets']['items']
        self.assertEqual(target['required'], ['roadmap_id', 'proposed_hierarchy'])
        self.assertEqual(roadmap_scope['properties']['targets']['maxItems'], 6)
        self.assertIn('new roadmap', tools.propose_tool()['function']['description'])
        self.assertEqual(tools.propose_plan_tool(), tools.propose_tool(None))

    def test_propose_task_schema_carries_assignee_labels(self) -> None:
        params = tools.propose_tool(ROADMAP)['function']['parameters']
        epic = params['properties']['proposed_hierarchy']['items']
        task = epic['properties']['features']['items']['properties']['tasks']['items']
        self.assertEqual(task['properties']['assignee_labels']['type'], 'array')
        self.assertEqual(task['properties']['assignee_labels']['items'], {'type': 'string'})
        # Legacy single label stays accepted.
        self.assertEqual(task['properties']['assignee_label'], {'type': 'string'})
        from app.core.contracts.sessions import ProposedTask

        parsed = ProposedTask.model_validate({'title': 'T', 'assignee_labels': ['Ana', 'me']})
        self.assertEqual(parsed.assignee_labels, ['Ana', 'me'])
        self.assertIsNone(parsed.assignee_label)

    def test_write_tools_roadmap_id_per_scope(self) -> None:
        for spec_fn, base in (
            (tools.save_memory_tool, ['content']),
            (tools.forget_memory_tool, ['memory_id']),
            (tools.add_task_comments_tool, ['task_ids', 'content']),
        ):
            roadmap_required = spec_fn(ROADMAP)['function']['parameters']['required']
            workspace_required = spec_fn(WORKSPACE)['function']['parameters']['required']
            self.assertEqual(roadmap_required, base)
            self.assertEqual(workspace_required, [*base, 'roadmap_id'])

    def test_revert_changes_and_ask_user_shapes(self) -> None:
        revert = tools.revert_changes_tool()['function']['parameters']
        self.assertEqual(sorted(revert['properties']), ['change_id', 'roadmap_id'])
        ask = tools.ask_user_tool()['function']['parameters']
        self.assertEqual(ask['properties']['lane']['enum'], ['edit', 'query', 'plan'])
        self.assertEqual(ask['properties']['questions']['maxItems'], 4)


class ClassificationTests(unittest.TestCase):
    def test_terminal_dispatcher_and_read_sets(self) -> None:
        for name in ('stage_edits', 'propose', 'revise_proposal', 'ask_user', 'revert_changes'):
            self.assertTrue(tools.is_terminal_tool(name), name)
            self.assertFalse(tools.is_dispatcher_tool(name), name)
        # The registry's schema-bound name still routes as the stage tool.
        self.assertTrue(tools.is_terminal_tool('plan_roadmap_operations'))
        self.assertTrue(tools.is_stage_tool('stage_edits'))
        self.assertTrue(tools.is_stage_tool('plan_roadmap_operations'))
        self.assertFalse(tools.is_stage_tool('propose'))
        for name in WORKSPACE_TOOL_NAMES | set(CONTEXT_TOOL_NAMES):
            self.assertTrue(tools.is_read_tool(name), name)
            self.assertTrue(tools.is_dispatcher_tool(name), name)
            self.assertFalse(tools.is_terminal_tool(name), name)
        for name in ('save_memory', 'forget_memory', 'add_task_comments'):
            self.assertTrue(tools.is_dispatcher_tool(name))
            self.assertFalse(tools.is_read_tool(name))
        self.assertEqual(tools.PROPOSE_PLAN_TOOL_NAME, 'propose')
        self.assertEqual(tools.STAGE_EDITS_TOOL_NAME, 'stage_edits')


if __name__ == '__main__':
    unittest.main()

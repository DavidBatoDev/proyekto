"""Terminal interpretation + the response-mode table + schema parity.

``interpret_terminals`` maps one response's terminal calls to a LoopResult
or per-call errors; ``build_clarifier_card`` / ``budget_clarifier_card`` are
the web-facing cards; ``orchestrator.finalize_step`` maps a run onto the
legacy ``response_mode`` / ``parse_mode`` / ``intent_type`` table.
"""

from __future__ import annotations

import json
import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.runs import RunBatch, RunCommit
from app.core.contracts.sessions import AgentSession, ClarifierCard, PendingPlan, RoadmapContext
from app.core.engine.llm_client import ToolCall
from app.core.engine.loop import LoopResult
from app.core.runtime import runs, terminal
from app.core.runtime import tools as tools_spec
from app.core.runtime.orchestrator import finalize_step
from app.core.runtime.service import StepContext
from app.core.tools.registry import get_context_tools, get_planning_tool
from tests.runtime_fakes import ALPHA, ALPHA_EPIC, BETA, MemoryStore, make_service, roadmap_session

def _call(name, args, call_id=None):
    return ToolCall(id=call_id or f'c_{name}', name=name, arguments=args, raw_arguments=json.dumps(args))


class InterpretTerminalsTests(unittest.TestCase):
    def test_stage_edits_default_roadmap_is_the_focus(self):
        ctx = terminal.TerminalContext(focus_roadmap_id=ALPHA, roadmap_titles={ALPHA: 'Alpha'})
        result = terminal.interpret_terminals(
            [_call('stage_edits', {'assistant_message': 'ok', 'operations': [{'op': 'add_epic', 'data': {'title': 'A'}}]})],
            ctx,
        )
        self.assertIsInstance(result, LoopResult)
        self.assertEqual(result.kind, 'batches')
        self.assertEqual(result.batches[0].roadmap_id, ALPHA)
        self.assertEqual(result.batches[0].roadmap_title, 'Alpha')
        self.assertIsNotNone(result.batches[0].operations_hash)

    def test_stage_edits_without_any_roadmap_is_missing_roadmap_id(self):
        result = terminal.interpret_terminals(
            [_call('stage_edits', {'operations': [{'op': 'add_epic', 'data': {'title': 'A'}}]})],
            terminal.TerminalContext(),
        )
        self.assertIsInstance(result, dict)
        self.assertEqual(result['c_stage_edits']['error']['code'], 'MISSING_ROADMAP_ID')

    def test_stage_edits_rejects_hallucinated_roadmap_id(self):
        result = terminal.interpret_terminals(
            [_call('stage_edits', {'roadmap_id': 'Alpha', 'operations': [{'op': 'add_epic', 'data': {'title': 'A'}}]})],
            terminal.TerminalContext(focus_roadmap_id=ALPHA),
        )
        self.assertEqual(result['c_stage_edits']['error']['code'], 'INVALID_ROADMAP_ID')

    def test_handle_from_another_roadmap_is_a_mismatch(self):
        merged = {
            'E1': {'id': ALPHA_EPIC, 'type': 'epic', 'title': 'Alpha epic', 'roadmap_id': ALPHA},
        }
        result = terminal.interpret_terminals(
            [_call('stage_edits', {'roadmap_id': BETA, 'operations': [{'op': 'update_node', 'node_ref': 'E1', 'patch': {'title': 'x'}}]})],
            terminal.TerminalContext(focus_roadmap_id=ALPHA, handle_map=merged, roadmap_titles={ALPHA: 'Alpha', BETA: 'Beta'}),
        )
        self.assertEqual(result['c_stage_edits']['error']['code'], 'HANDLE_ROADMAP_MISMATCH')
        self.assertIn('Alpha', result['c_stage_edits']['error']['message'])

    def test_duplicate_epics_use_the_batch_roadmaps_own_map(self):
        ctx = terminal.TerminalContext(
            focus_roadmap_id=ALPHA,
            handle_maps_by_roadmap={
                ALPHA: {'E1': {'id': ALPHA_EPIC, 'type': 'epic', 'title': 'Growth'}},
                BETA: {'R1.E1': {'id': 'b-1', 'type': 'epic', 'title': 'Billing'}},
            },
        )
        result = terminal.interpret_terminals(
            [_call('stage_edits', {'roadmap_id': BETA, 'operations': [{'op': 'add_epic', 'data': {'title': 'Growth'}}]})],
            ctx,
        )
        # "Growth" lives on Alpha, so adding it to Beta is not a duplicate.
        self.assertIsInstance(result, LoopResult)
        self.assertEqual(result.kind, 'batches')

    def test_multiple_terminals_of_different_kinds(self):
        result = terminal.interpret_terminals(
            [_call('propose', {'summary': 's'}, 'a'), _call('ask_user', {'question': 'q'}, 'b')],
            terminal.TerminalContext(),
        )
        self.assertEqual(set(result), {'a', 'b'})
        self.assertTrue(all(v['error']['code'] == 'MULTIPLE_TERMINALS' for v in result.values()))

    def test_two_propose_calls_are_rejected(self):
        result = terminal.interpret_terminals(
            [_call('propose', {'summary': 's'}, 'a'), _call('propose', {'summary': 't'}, 'b')],
            terminal.TerminalContext(),
        )
        self.assertTrue(all(v['error']['code'] == 'MULTIPLE_TERMINALS' for v in result.values()))

    def test_unknown_terminal(self):
        result = terminal.interpret_terminals([_call('nope', {})], terminal.TerminalContext())
        self.assertEqual(result['c_nope']['error']['code'], 'UNKNOWN_TERMINAL')

    def test_verify_handler_only_accepts_propose(self):
        session = roadmap_session()
        handler = terminal.for_verify(session, None)
        result = handler([_call('stage_edits', {'operations': [{'op': 'add_epic', 'data': {'title': 'A'}}]})])
        self.assertEqual(result['c_stage_edits']['error']['code'], 'TERMINAL_NOT_ALLOWED')
        proposal = handler([_call('propose', {'summary': 'Follow-up', 'goal': 'g'})])
        self.assertEqual(proposal.kind, 'plan_proposal')

    def test_materialize_handler_pins_the_roadmap(self):
        session = roadmap_session()
        handler = terminal.for_materialize(session, None, BETA)
        result = handler([_call('stage_edits', {'operations': [{'op': 'add_epic', 'data': {'title': 'A'}}]})])
        self.assertEqual(result.kind, 'batches')
        self.assertEqual(result.batches[0].roadmap_id, BETA)

    def test_investigate_handler_reads_session_state(self):
        session = roadmap_session()
        session.metadata.roadmaps[ALPHA] = RoadmapContext(
            roadmap_id=ALPHA,
            title='Alpha',
            handle_map={'E1': {'id': ALPHA_EPIC, 'type': 'epic', 'title': 'Growth', 'roadmap_id': ALPHA}},
        )
        session.metadata.pending_plan = PendingPlan(
            source_user_message='plan', summary='s', goal='g',
            proposed_hierarchy=[{'title': 'Referral Rewards', 'features': []}],
        )
        handler = terminal.for_investigate(session, None)
        revised = handler([
            _call('revise_proposal', {'assistant_message': 'x', 'revision_operations': [{'op': 'rename_epic', 'epic_title': 'Referral Rewards', 'new_title': 'Loyalty'}]})
        ])
        self.assertEqual(revised.kind, 'plan_revision')
        dup = handler([_call('stage_edits', {'operations': [{'op': 'add_epic', 'data': {'title': 'growth'}}]})])
        self.assertEqual(dup.kind, 'chat')
        self.assertEqual(dup.termination_reason, 'duplicate_noop')
        staged = handler([_call('stage_edits', {'operations': [{'op': 'update_node', 'node_ref': 'E1', 'patch': {'title': 'Growth 2'}}]})])
        self.assertEqual(staged.kind, 'batches')
        self.assertEqual(staged.batches[0].operations[0].node_id, ALPHA_EPIC)
        self.assertEqual(staged.batches[0].roadmap_title, 'Alpha')


class ClarifierCardTests(unittest.TestCase):
    def _assert_card_survives_contract(self, card):
        # MessageResponse.clarifier is typed ClarifierCard — pydantic silently
        # strips unknown keys, so `questions` must exist on the model or the
        # whole feature no-ops on the wire.
        dumped = ClarifierCard.model_validate(card).model_dump()
        self.assertEqual(
            [q['question'] for q in dumped['questions']],
            [q['question'] for q in card['questions']],
        )

    def test_legacy_dict_synthesizes_questions(self):
        card = terminal.build_clarifier_card(
            {'lane': 'edit', 'question': 'Which one?', 'options': ['A', 'B'], 'allow_custom': True}
        )
        self.assertEqual(card['question'], 'Which one?')
        self.assertIn('question_id', card)
        self.assertEqual(card['options'], ['A', 'B'])
        questions = card['questions']
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]['question'], 'Which one?')
        self.assertEqual([o['label'] for o in questions[0]['options']], ['A', 'B'])
        self.assertEqual(card['reason'], 'agent_clarifier')
        self._assert_card_survives_contract(card)

    def test_multi_questions_with_legacy_mirror(self):
        questions = [
            {
                'id': 'q1', 'header': 'Target epic', 'question': 'Which epic?',
                'multi_select': False, 'allow_custom': True,
                'options': [{'label': 'Growth', 'description': 'has 3 features'}],
            },
            {
                'id': 'q2', 'header': None, 'question': 'Which fields?',
                'multi_select': True, 'allow_custom': True,
                'options': [{'label': 'Status', 'description': None}],
            },
        ]
        card = terminal.build_clarifier_card(
            {'lane': 'edit', 'questions': questions, 'question': 'Which epic?', 'options': ['Growth'], 'allow_custom': True}
        )
        self.assertEqual(len(card['questions']), 2)
        self.assertTrue(card['questions'][1]['multi_select'])
        self.assertEqual(card['question'], 'Which epic?')
        self.assertEqual(card['options'], ['Growth'])
        self._assert_card_survives_contract(card)

    def test_budget_card_is_answerable_free_form(self):
        card = terminal.budget_clarifier_card()
        self.assertEqual(card['reason'], 'budget_exhausted')
        questions = card['questions']
        self.assertEqual(len(questions), 1)
        self.assertTrue(questions[0]['allow_custom'])
        self.assertEqual(questions[0]['options'], [])
        self.assertEqual(card['question'], terminal.BUDGET_MESSAGE)
        self._assert_card_survives_contract(card)

    def test_empty_clarifier_is_none(self):
        self.assertIsNone(terminal.build_clarifier_card(None))
        self.assertIsNone(terminal.build_clarifier_card({'question': '', 'options': []}))


class _RunFixture:
    def __init__(self):
        self.store = MemoryStore()
        self.service = make_service(self.store)
        self.session = roadmap_session()
        self.store.create(self.session)
        self.ctx = StepContext(service=self.service, auth_header='Bearer x', trace_id='trace-1')
        self.run = runs.new_run(self.session, trace_id='trace-1', user_message='do the thing')


class FinalizeStepModeTests(unittest.TestCase):
    """The response-mode table (today's values plus run_step / run_report)."""

    def test_chat_with_reads_is_context_answer(self):
        fx = _RunFixture()
        fx.ctx.chat_used_read_tools = True
        runs.set_done(fx.run, '3 items are blocked.')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('chat', 'context_answer', 'roadmap_query'))
        self.assertEqual(result.operations, [])
        self.assertEqual(result.run.next, 'done')
        self.assertTrue(result.segment_ended)

    def test_chat_without_reads_is_general_question(self):
        fx = _RunFixture()
        runs.set_done(fx.run, 'hi')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('chat', 'chat', 'general_question'))

    def test_running_step_is_run_step(self):
        fx = _RunFixture()
        runs.set_continue(fx.run)
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('chat', 'run_step', 'unclear'))
        self.assertEqual(result.assistant_message, '')
        self.assertFalse(result.segment_ended)
        # No history appended while the segment is open.
        self.assertEqual(fx.session.messages, [])

    def test_clarifier_checkpoint(self):
        fx = _RunFixture()
        card = terminal.build_clarifier_card({'lane': 'edit', 'question': 'Which one?', 'options': ['A', 'B']})
        runs.set_awaiting(fx.run, 'clarifier', clarifier=card, asked_in_phase='investigate')
        fx.run.final_message = 'Which one?'
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('chat', 'clarifier', 'roadmap_edit'))
        self.assertEqual(result.clarifier_card['question'], 'Which one?')
        self.assertEqual(result.run.checkpoint, 'clarifier')

    def test_proposal_checkpoint(self):
        fx = _RunFixture()
        fx.ctx.proposal_payload = {'summary': 'A plan'}
        fx.ctx.intent_hint = 'roadmap_plan'
        runs.set_awaiting(fx.run, 'proposal', plan_id='plan-1')
        fx.run.final_message = 'A plan'
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('plan_proposal', 'plan_proposal', 'roadmap_plan'))
        self.assertEqual(result.plan_proposal_payload, {'summary': 'A plan'})

    def test_budget_is_clarifier_with_unclear_intent(self):
        fx = _RunFixture()
        fx.ctx.clarifier_card = terminal.budget_clarifier_card()
        runs.set_done(fx.run, terminal.BUDGET_MESSAGE)
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('chat', 'clarifier', 'unclear'))
        self.assertEqual(result.clarifier_card['reason'], 'budget_exhausted')

    def test_commit_this_step_is_edit_plan_with_legacy_fields(self):
        fx = _RunFixture()
        op = RoadmapOperation(op='add_epic', data={'title': 'Growth'})
        batch = RunBatch(roadmap_id=ALPHA, roadmap_title='Alpha', operations=[op], assistant_message='Added Growth.')
        fx.run.batches.append(batch)
        fx.run.commits.append(
            RunCommit(batch_id=batch.batch_id, roadmap_id=ALPHA, status='committed', change_id='chg-1', impacted_summary={'created': 1, 'modified': 0, 'deleted': 0})
        )
        fx.ctx.step_batch_ids.add(batch.batch_id)
        fx.ctx.step_commit_batch_ids.add(batch.batch_id)
        fx.ctx.verify_reported = True
        runs.set_done(fx.run, 'Committed 1 change to "Alpha".')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual((result.response_mode, result.parse_mode, result.intent_type), ('edit_plan', 'run_report', 'roadmap_edit'))
        self.assertEqual(len(result.operations), 1)
        self.assertTrue(result.commit_summary.committed)
        self.assertEqual(result.commit_summary.change_id, 'chg-1')
        self.assertEqual(result.staged_operations_count, 1)
        self.assertEqual(len(result.commits), 1)
        self.assertEqual(len(result.commits[0].operations), 1)
        # History persisted together at segment end: user then assistant.
        self.assertEqual([m.role for m in fx.session.messages], ['user', 'assistant'])
        self.assertEqual(fx.session.messages[0].content, 'do the thing')

    def test_failed_focus_commit_reports_failure_summary(self):
        fx = _RunFixture()
        batch = RunBatch(roadmap_id=ALPHA, operations=[RoadmapOperation(op='add_epic', data={'title': 'G'})])
        fx.run.batches.append(batch)
        fx.run.commits.append(RunCommit(batch_id=batch.batch_id, roadmap_id=ALPHA, status='failed', error_code='STALE_REVISION', error_message='nope'))
        fx.ctx.step_commit_batch_ids.add(batch.batch_id)
        runs.set_done(fx.run, 'failed')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual(result.response_mode, 'edit_plan')
        self.assertFalse(result.commit_summary.committed)
        self.assertEqual(result.commit_summary.error_code, 'STALE_REVISION')

    def test_commits_from_earlier_steps_carry_no_operations(self):
        fx = _RunFixture()
        batch = RunBatch(roadmap_id=BETA, operations=[RoadmapOperation(op='add_epic', data={'title': 'B'})])
        fx.run.batches.append(batch)
        fx.run.commits.append(RunCommit(batch_id=batch.batch_id, roadmap_id=BETA, status='committed'))
        runs.set_done(fx.run, 'done')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertIsNone(result.commits[0].operations)
        self.assertIsNone(result.commit_summary)  # not the focus roadmap
        self.assertEqual(result.operations, [])

    def test_terminal_run_is_archived_in_run_history(self):
        fx = _RunFixture()
        runs.set_failed(fx.run, 'provider_error', 'boom', final_message='sorry')
        result = finalize_step(fx.ctx, fx.session, fx.run)
        self.assertEqual(result.run.status, 'failed')
        self.assertEqual([entry.run_id for entry in fx.session.metadata.run_history], [fx.run.run_id])
        self.assertEqual(fx.session.metadata.run_history[0].error_code, 'provider_error')


class StageEditsSchemaParityTests(unittest.TestCase):
    """`stage_edits` is the registry planning tool renamed: identical operation
    schema, `revision_operations` ALWAYS stripped (plan revisions go through
    `revise_proposal`), `operations.minItems=1`, plus a `roadmap_id` property."""

    @staticmethod
    def _tool(tools, name):
        return next(t for t in tools if t['function']['name'] == name)

    def test_stage_edits_schema_equals_registry_minus_revision_operations_plus_roadmap_id(self):
        registry = get_planning_tool()['function']['parameters']
        for has_pending_plan in (False, True):
            stage = self._tool(tools_spec.build_tools(has_pending_plan=has_pending_plan), 'stage_edits')
            params = stage['function']['parameters']
            props = params['properties']
            self.assertNotIn('revision_operations', props)
            self.assertIn('roadmap_id', props)
            self.assertNotIn('DUAL-TARGET CONTRACT', stage['function']['description'])
            self.assertNotIn('CLARIFIER CONTRACT', stage['function']['description'])
            self.assertEqual(props['operations']['minItems'], 1)
            expected = {
                key: value
                for key, value in registry['properties'].items()
                if key != 'revision_operations'
            }
            expected['operations'] = {**expected['operations'], 'minItems': 1}
            actual = {key: value for key, value in props.items() if key != 'roadmap_id'}
            self.assertEqual(actual, expected)
            # Roadmap scope: roadmap_id is optional (defaults to the focus).
            self.assertEqual(params['required'], registry['required'])
        self.assertNotIn('minItems', registry['properties']['operations'])
        self.assertNotIn('roadmap_id', registry['properties'])

    def test_revise_proposal_only_when_plan_pending(self):
        without = {t['function']['name'] for t in tools_spec.build_tools()}
        with_plan = {t['function']['name'] for t in tools_spec.build_tools(has_pending_plan=True)}
        self.assertNotIn('revise_proposal', without)
        self.assertIn('revise_proposal', with_plan)
        self.assertNotIn('plan_roadmap_operations', with_plan)
        self.assertNotIn('propose_plan', with_plan)
        revise = self._tool(tools_spec.build_tools(has_pending_plan=True), 'revise_proposal')
        params = revise['function']['parameters']
        self.assertEqual(sorted(params['required']), ['assistant_message', 'revision_operations'])
        registry_revision = get_planning_tool()['function']['parameters']['properties'][
            'revision_operations'
        ]
        self.assertEqual(
            params['properties']['revision_operations']['items'], registry_revision['items']
        )

    def test_required_strip_leaves_registry_literals_untouched(self):
        tools_spec.build_tools(scope={'kind': 'workspace', 'workspace_id': 'ws'})
        tools_spec.build_tools()
        for spec in get_context_tools():
            params = spec['function']['parameters']
            if 'roadmap_id' in params.get('properties', {}):
                self.assertIn('roadmap_id', params['required'], spec['function']['name'])


if __name__ == '__main__':
    unittest.main()

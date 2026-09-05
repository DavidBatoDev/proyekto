"""End-to-end orchestrator path: ``orchestrator.step`` -> phases -> loop ->
``StepResult`` with a scripted fake LLM, an in-memory store and a fake
NestJS client. Exercises the input table, the checkpoint policy, the
per-roadmap commits, the checkpoints and the legacy response fields together
without a live model or network.
"""

from __future__ import annotations

import json
import unittest
from time import monotonic
from uuid import uuid4

from fastapi.exceptions import HTTPException

from app.core import trace
from app.core.runtime import orchestrator
from app.core.runtime.sentinels import parse_user_input
from tests.runtime_fakes import (
    ALPHA,
    ALPHA_EPIC,
    AUTH,
    BETA,
    OTHER_AUTH,
    FakeLLM,
    FakeNest,
    MemoryStore,
    ProviderDown,
    add_epics,
    make_service,
    patched_llm,
    roadmap_session,
    settings_with,
    stage_args,
    text_resp,
    tool_resp,
    workspace_session,
)


def _bootstrap(session, *, nest=None, settings=None):
    store = MemoryStore()
    nest = nest or FakeNest()
    service = make_service(store, nest, settings)
    store.create(session)
    return store, nest, service


def _send(service, session_id, message, *, refs=None, capabilities=('continue',), auth=AUTH, started_offset=0.0):
    session = service.get_session_or_404(session_id)
    ctx = service.new_step_context(
        auth_header=auth, trace_id=str(uuid4()), sync_mode='continue' not in capabilities
    )
    if started_offset:
        ctx.started_monotonic = monotonic() - started_offset
    return ctx, orchestrator.step(ctx, session, parse_user_input(session, message, refs))


def _continue(service, session_id, run_id, *, auth=AUTH):
    session = service.get_session_or_404(session_id)
    ctx = service.new_step_context(auth_header=auth, trace_id=str(uuid4()), sync_mode=False)
    return ctx, orchestrator.step(ctx, session, None, continue_run_id=run_id)


def _confirm(plan_id=None):
    return '__plan_decision__\n' + json.dumps({'decision': 'confirm', 'plan_id': plan_id})


def _reject(plan_id=None):
    return '__plan_decision__\n' + json.dumps({'decision': 'reject', 'plan_id': plan_id})


class _Base(unittest.TestCase):
    def setUp(self) -> None:
        trace.store.reset_for_tests()

    def tearDown(self) -> None:
        trace.store.reset_for_tests()


class RoadmapScopeTests(_Base):
    def test_small_edit_executes_immediately_and_reports_commit(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args([{'op': 'add_epic', 'data': {'title': 'Growth'}}], message='Added Growth.')),
            text_resp('Added the Growth epic to Alpha.'),
        ]):
            ctx, result = _send(service, 'sess-alpha', 'add an epic called Growth')
        run = result.run
        self.assertEqual((run.status, run.next, run.phase), ('done', 'done', 'verify'))
        self.assertEqual(result.response_mode, 'edit_plan')
        self.assertEqual(result.parse_mode, 'run_report')
        self.assertEqual(result.intent_type, 'roadmap_edit')
        self.assertTrue(result.commit_summary.committed)
        self.assertEqual(len(result.operations), 1)
        self.assertEqual(result.assistant_message, 'Added the Growth epic to Alpha.')
        self.assertEqual(run.verify.status, 'verified')
        # Direct focus-roadmap edit: no preview, one commit carrying the run ids.
        self.assertEqual(nest.preview_calls, [])
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(nest.commit_calls[0]['session_id'], 'sess-alpha')
        self.assertEqual(nest.commit_calls[0]['run_id'], run.run_id)
        self.assertEqual(nest.commit_calls[0]['payload']['operations'][0]['op'], 'add_epic')
        self.assertEqual([c.status for c in result.commits], ['committed'])
        self.assertEqual(len(result.commits[0].operations), 1)
        self.assertEqual(result.staged_operations_count, 1)
        # Investigate + verify model calls: scope cache key, verify tools = [propose].
        self.assertEqual(FakeLLM.calls[0]['prompt_cache_key'], f'roadmap:{ALPHA}')
        self.assertEqual(FakeLLM.calls[1]['tools'], ['propose'])
        # History persisted together at segment end.
        persisted = store.get('sess-alpha')
        self.assertEqual([m.role for m in persisted.messages], ['user', 'assistant'])
        self.assertEqual(persisted.metadata.run.run_id, run.run_id)
        self.assertEqual(persisted.metadata.run_history[0].committed_roadmap_ids, [ALPHA])
        self.assertEqual(store.lock_events, ['acquired', 'released'])
        self.assertEqual(len(persisted.metadata.change_history), 1)
        self.assertEqual(persisted.metadata.change_history[0].run_id, run.run_id)

    def test_focus_delete_executes_immediately(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args([{'op': 'delete_node', 'node_type': 'epic', 'node_ref': 'E1'}], message='Deleted it.')),
            text_resp('Deleted the epic.'),
        ]):
            _ctx, result = _send(service, 'sess-alpha', 'delete the first epic')
        self.assertEqual(result.run.status, 'done')
        self.assertEqual(result.response_mode, 'edit_plan')
        self.assertTrue(result.commit_summary.committed)
        self.assertEqual(nest.commit_calls[0]['payload']['operations'][0]['node_id'], ALPHA_EPIC)
        self.assertEqual(nest.preview_calls, [])

    def test_more_than_focus_cap_requires_confirmation(self):
        _store, nest, service = _bootstrap(roadmap_session(), settings=settings_with(agent_direct_edit_max_operations_focus=3))
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(4)))]):
            _ctx, result = _send(service, 'sess-alpha', 'add four epics')
        self.assertEqual(result.run.status, 'awaiting_user')
        self.assertEqual(result.run.checkpoint, 'proposal')
        self.assertEqual(result.response_mode, 'plan_proposal')
        self.assertEqual(result.plan_proposal_payload['kind'], 'edits')
        self.assertEqual(nest.commit_calls, [])

    def test_two_roadmap_edit_requires_confirmation_and_commits_each(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([
            tool_resp('get_roadmap_overview', {'roadmap_id': BETA}),
            tool_resp('stage_edits', stage_args(add_epics(1, 'Alpha'), message='Alpha done.')).__class__(
                content=None,
                tool_calls=[
                    *tool_resp('stage_edits', stage_args(add_epics(1, 'Alpha'), message='Alpha done.'), call_id='a').tool_calls,
                    *tool_resp('stage_edits', stage_args(add_epics(1, 'Beta'), roadmap_id=BETA, message='Beta done.'), call_id='b').tool_calls,
                ],
            ),
        ]):
            _ctx, result = _send(service, 'sess-alpha', 'add an epic to Alpha and Beta')
        self.assertEqual(result.run.status, 'awaiting_user')
        self.assertEqual(result.run.checkpoint, 'proposal')
        plan = store.get('sess-alpha').metadata.pending_plan
        self.assertEqual(plan.kind, 'edits')
        self.assertEqual([t.roadmap_id for t in plan.targets], [ALPHA, BETA])
        self.assertEqual(sorted(result.run.focus_roadmap_ids), sorted([ALPHA, BETA]))
        self.assertEqual(nest.commit_calls, [])

        with patched_llm([text_resp('Committed to both roadmaps.')]):
            _ctx, confirmed = _send(service, 'sess-alpha', _confirm(plan.plan_id))
        self.assertEqual(confirmed.run.status, 'done')
        self.assertEqual(confirmed.run.run_id, result.run.run_id)  # same run, new segment
        self.assertEqual(len(confirmed.run.segments if hasattr(confirmed.run, 'segments') else []), 2)
        self.assertEqual([c['roadmap_id'] for c in nest.commit_calls], [ALPHA, BETA])
        self.assertEqual([c['roadmap_id'] for c in nest.preview_calls], [ALPHA, BETA])
        self.assertEqual([c.status for c in confirmed.commits], ['committed', 'committed'])
        self.assertTrue(all(c.operations is not None for c in confirmed.commits))
        self.assertTrue(confirmed.commit_summary.committed)  # focus roadmap's commit
        self.assertEqual(confirmed.response_mode, 'edit_plan')
        self.assertIsNone(store.get('sess-alpha').metadata.pending_plan)
        self.assertEqual(confirmed.run.verify.status, 'verified')

    def test_propose_then_confirm_materializes_per_target(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([
            tool_resp(
                'propose',
                {
                    'summary': 'Two roadmaps get an epic.',
                    'goal': 'grow',
                    'targets': [
                        {'roadmap_id': ALPHA, 'proposed_hierarchy': [{'title': 'Alpha growth', 'features': []}]},
                        {'roadmap_id': BETA, 'proposed_hierarchy': [{'title': 'Beta growth', 'features': []}]},
                    ],
                },
            )
        ]):
            _ctx, result = _send(service, 'sess-alpha', 'plan growth for both')
        self.assertEqual(result.response_mode, 'plan_proposal')
        self.assertEqual(result.intent_type, 'roadmap_plan')
        plan = store.get('sess-alpha').metadata.pending_plan
        self.assertEqual(plan.kind, 'plan')
        self.assertEqual([t.roadmap_id for t in plan.targets], [ALPHA, BETA])
        self.assertEqual(plan.run_id, result.run.run_id)

        with patched_llm([
            tool_resp('stage_edits', stage_args(add_epics(1, 'Alpha growth'), roadmap_id=ALPHA)),
            tool_resp('stage_edits', stage_args(add_epics(1, 'Beta growth'), roadmap_id=BETA)),
            text_resp('Both roadmaps now have their growth epic.'),
        ]):
            _ctx, confirmed = _send(service, 'sess-alpha', _confirm(plan.plan_id))
        self.assertEqual(confirmed.run.status, 'done')
        # One materialize loop per target, pinned to that roadmap.
        self.assertEqual(FakeLLM.calls[0]['prompt_cache_key'], f'roadmap:{ALPHA}')
        self.assertEqual(FakeLLM.calls[1]['prompt_cache_key'], f'roadmap:{BETA}')
        self.assertIn('stage_edits', FakeLLM.calls[0]['tools'])
        self.assertNotIn('propose', FakeLLM.calls[0]['tools'])
        self.assertEqual([c['roadmap_id'] for c in nest.commit_calls], [ALPHA, BETA])
        self.assertEqual([c['roadmap_id'] for c in nest.preview_calls], [ALPHA, BETA])
        self.assertEqual([c.status for c in confirmed.commits], ['committed', 'committed'])
        self.assertIsNone(store.get('sess-alpha').metadata.pending_plan)

    def test_clarifier_roundtrip_resumes_investigate_same_run(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([tool_resp('ask_user', {'question': 'Which epic?', 'options': ['Growth', 'Retention']})]):
            _ctx, asked = _send(service, 'sess-alpha', 'rename the epic')
        self.assertEqual(asked.run.status, 'awaiting_user')
        self.assertEqual(asked.run.checkpoint, 'clarifier')
        self.assertEqual(asked.parse_mode, 'clarifier')
        self.assertEqual(asked.clarifier_card['question'], 'Which epic?')
        first_trace = asked.run.trace_id
        # The segment ended: the user turn + the question are in history.
        self.assertEqual([m.role for m in store.get('sess-alpha').messages], ['user', 'assistant'])

        with patched_llm([text_resp('Renamed Growth.')]):
            _ctx, answered = _send(service, 'sess-alpha', '__clarifier_answer__\n' + json.dumps({'answer': 'Growth'}))
        self.assertEqual(answered.run.run_id, asked.run.run_id)
        self.assertEqual(answered.run.status, 'done')
        self.assertNotEqual(answered.run.trace_id, first_trace)
        persisted = store.get('sess-alpha')
        self.assertEqual(len(persisted.metadata.run.segments), 2)
        self.assertEqual([m.content for m in persisted.messages][-2:], ['Growth', 'Renamed Growth.'])
        # The folded answer is the live user turn of the resumed segment.
        user_turns = [m for m in FakeLLM.calls[0]['messages'] if m.get('role') == 'user']
        self.assertEqual(user_turns[-1]['content'], 'Growth')

    def test_plain_message_supersedes_awaiting_run_but_keeps_pending_plan(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([tool_resp('propose', {'summary': 'A plan', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E', 'features': []}]})]):
            _ctx, proposed = _send(service, 'sess-alpha', 'plan something')
        self.assertEqual(proposed.run.status, 'awaiting_user')
        with patched_llm([text_resp('Sure, two epics.')]):
            _ctx, chat = _send(service, 'sess-alpha', 'how many epics are there?')
        self.assertNotEqual(chat.run.run_id, proposed.run.run_id)
        self.assertEqual(chat.run.status, 'done')
        persisted = store.get('sess-alpha')
        self.assertIsNotNone(persisted.metadata.pending_plan)
        superseded = [entry for entry in persisted.metadata.run_history if entry.run_id == proposed.run.run_id]
        self.assertEqual(superseded[0].status, 'cancelled')
        self.assertEqual(superseded[0].error_code, 'superseded_by_new_message')
        # The pending proposal still renders for the model (revise_proposal available).
        self.assertIn('revise_proposal', FakeLLM.calls[0]['tools'])

    def test_reject_cancels_without_model_call(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([tool_resp('propose', {'summary': 'A plan', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E', 'features': []}]})]):
            _ctx, proposed = _send(service, 'sess-alpha', 'plan something')
        plan_id = store.get('sess-alpha').metadata.pending_plan.plan_id
        with patched_llm([]):
            _ctx, rejected = _send(service, 'sess-alpha', _reject(plan_id))
        self.assertEqual(FakeLLM.calls, [])
        self.assertEqual(rejected.run.run_id, proposed.run.run_id)
        self.assertEqual(rejected.run.status, 'cancelled')
        self.assertEqual(rejected.assistant_message, orchestrator.REJECTED_MESSAGE)
        self.assertEqual(rejected.provider_used, 'rule_based')
        self.assertIsNone(store.get('sess-alpha').metadata.pending_plan)
        self.assertEqual(nest.commit_calls, [])

    def test_confirm_without_pending_plan_answers_without_model_call(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([]):
            _ctx, result = _send(service, 'sess-alpha', _confirm('missing'))
        self.assertEqual(result.run.status, 'done')
        self.assertEqual(result.assistant_message, orchestrator.NO_PROPOSAL_MESSAGE)
        self.assertEqual(FakeLLM.calls, [])

    def test_provider_failure_fails_run_with_fallback_text(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([ProviderDown('boom')]):
            _ctx, result = _send(service, 'sess-alpha', 'add an epic')
        self.assertEqual(result.run.status, 'failed')
        self.assertEqual(result.run.error.code, 'provider_error')
        self.assertIn("I hit an issue reaching the model", result.assistant_message)
        self.assertEqual(result.provider_used, 'rule_based')
        self.assertTrue(result.fallback_used)
        self.assertEqual(result.provider_error_code, 'v2_provider_error')
        self.assertEqual(result.response_mode, 'chat')
        self.assertEqual([m.role for m in store.get('sess-alpha').messages], ['user', 'assistant'])

    def test_resumed_step_does_not_duplicate_the_user_turn(self):
        store, nest, service = _bootstrap(roadmap_session(), settings=settings_with(agent_run_step_budget_seconds=10))
        with patched_llm([tool_resp('search_nodes', {'query': 'growth'})]):
            _ctx, paused = _send(service, 'sess-alpha', 'find growth and rename it', started_offset=30)
        self.assertEqual((paused.run.status, paused.run.next), ('running', 'continue'))
        self.assertEqual(paused.parse_mode, 'run_step')
        self.assertEqual(paused.assistant_message, '')
        persisted = store.get('sess-alpha')
        self.assertEqual(persisted.messages, [])  # nothing appended mid-segment
        self.assertIsNotNone(persisted.metadata.run.loop_transcript_key)
        self.assertEqual(persisted.metadata.run.phase_usage['investigate']['turns'], 1)

        with patched_llm([text_resp('Renamed it.')]):
            _ctx, resumed = _continue(service, 'sess-alpha', paused.run.run_id)
        self.assertEqual(resumed.run.status, 'done')
        self.assertEqual(resumed.run.trace_id, paused.run.trace_id)  # continue reuses the segment trace
        self.assertEqual(resumed.run.step, 2)
        user_turns = [m for m in FakeLLM.calls[0]['messages'] if m.get('role') == 'user']
        self.assertEqual(len(user_turns), 1)
        self.assertEqual(user_turns[0]['content'], 'find growth and rename it')
        # The replayed tool call + output rode along.
        types = [m.get('type') for m in FakeLLM.calls[0]['messages'] if m.get('type')]
        self.assertEqual(types, ['function_call', 'function_call_output'])
        persisted = store.get('sess-alpha')
        self.assertEqual([m.role for m in persisted.messages], ['user', 'assistant'])
        self.assertIsNone(persisted.metadata.run.loop_transcript_key)

    def test_owner_mismatch_404s(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([text_resp('never')]):
            with self.assertRaises(HTTPException) as ctx:
                _send(service, 'sess-alpha', 'hello', auth=OTHER_AUTH)
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail['code'], 'SESSION_NOT_FOUND')
        self.assertEqual(store.lock_events, [])

    def test_legacy_client_runs_in_one_request(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args(add_epics(1))),
            text_resp('Done.'),
        ]):
            _ctx, result = _send(service, 'sess-alpha', 'add an epic', capabilities=())
        self.assertEqual((result.run.status, result.run.next), ('done', 'done'))
        self.assertEqual(result.response_mode, 'edit_plan')
        self.assertTrue(result.commit_summary.committed)

    def test_revert_bypasses_the_gate(self):
        store, nest, service = _bootstrap(roadmap_session())
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(1, 'Growth'))), text_resp('Added.')]):
            _ctx, first = _send(service, 'sess-alpha', 'add Growth')
        history = store.get('sess-alpha').metadata.change_history
        self.assertEqual(len(history), 1)
        with patched_llm([tool_resp('revert_changes', {}), text_resp('Reverted.')]):
            _ctx, reverted = _send(service, 'sess-alpha', 'undo that')
        self.assertEqual(reverted.run.status, 'done')
        self.assertEqual(reverted.response_mode, 'edit_plan')
        # The inverse batch previews (revert) then commits directly, no confirmation.
        self.assertEqual(len(nest.preview_calls), 1)
        self.assertEqual(len(nest.commit_calls), 2)
        self.assertEqual(nest.commit_calls[1]['payload']['operations'][0]['op'], 'delete_node')


class WorkspaceScopeTests(_Base):
    def test_sixteen_ops_become_edits_proposal_then_confirm_executes(self):
        store, nest, service = _bootstrap(workspace_session())
        with patched_llm([tool_resp('stage_edits', stage_args(add_epics(16), roadmap_id=ALPHA, message='Sixteen epics.'))]):
            _ctx, result = _send(service, 'sess-ws', 'add sixteen epics to Alpha')
        self.assertEqual(result.run.status, 'awaiting_user')
        self.assertEqual(result.run.checkpoint, 'proposal')
        self.assertEqual(result.response_mode, 'plan_proposal')
        plan = store.get('sess-ws').metadata.pending_plan
        self.assertEqual(plan.kind, 'edits')
        self.assertEqual(plan.targets[0].operations_count, 16)
        self.assertEqual(len(plan.targets[0].summary_lines), 16)
        self.assertEqual(plan.summary, 'Sixteen epics.')
        self.assertEqual(result.run.batches, [] if not hasattr(result.run, 'batches') else result.run.batches)
        self.assertEqual(nest.commit_calls, [])

        with patched_llm([text_resp('Added sixteen epics to Alpha.')]):
            _ctx, confirmed = _send(service, 'sess-ws', _confirm(plan.plan_id))
        self.assertEqual(confirmed.run.status, 'done')
        self.assertEqual(len(nest.preview_calls), 1)  # proposal batches preview first
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(len(nest.commit_calls[0]['payload']['operations']), 16)
        self.assertEqual(confirmed.commits[0].status, 'committed')
        self.assertIsNone(confirmed.commit_summary)  # no focus roadmap in workspace scope
        self.assertEqual(confirmed.operations, [])
        self.assertIsNone(store.get('sess-ws').metadata.pending_plan)

    def test_small_workspace_edit_executes_immediately(self):
        store, nest, service = _bootstrap(workspace_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args(add_epics(2), roadmap_id=ALPHA)),
            text_resp('Added two epics.'),
        ]):
            _ctx, result = _send(service, 'sess-ws', 'add two epics to Alpha')
        self.assertEqual(result.run.status, 'done')
        self.assertEqual(len(nest.commit_calls), 1)
        self.assertEqual(nest.preview_calls, [])
        self.assertEqual(result.commits[0].roadmap_id, ALPHA)
        # Workspace scope: the loaded roadmap is prefixed, never bare.
        self.assertEqual(store.get('sess-ws').metadata.roadmaps[ALPHA].handle_prefix, 'R1')

    def test_delete_requires_confirmation(self):
        store, nest, service = _bootstrap(workspace_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args([{'op': 'delete_node', 'node_type': 'epic', 'node_id': ALPHA_EPIC}], roadmap_id=ALPHA, message='Delete the epic.'))
        ]):
            _ctx, result = _send(service, 'sess-ws', 'delete the Alpha epic')
        self.assertEqual(result.run.checkpoint, 'proposal')
        plan = store.get('sess-ws').metadata.pending_plan
        self.assertTrue(plan.targets[0].contains_delete)
        self.assertEqual(plan.proposed_hierarchy, [])  # delete-only edits proposal still records
        self.assertEqual(nest.commit_calls, [])

    def test_stage_without_roadmap_id_is_fed_back(self):
        store, nest, service = _bootstrap(workspace_session())
        with patched_llm([
            tool_resp('stage_edits', stage_args(add_epics(1))),
            tool_resp('stage_edits', stage_args(add_epics(1), roadmap_id=BETA)),
            text_resp('Done.'),
        ]):
            _ctx, result = _send(service, 'sess-ws', 'add an epic')
        self.assertEqual(result.run.status, 'done')
        outputs = [m.get('output') or '' for m in FakeLLM.calls[1]['messages'] if m.get('type') == 'function_call_output']
        self.assertTrue(any('MISSING_ROADMAP_ID' in o for o in outputs))
        self.assertEqual(nest.commit_calls[0]['roadmap_id'], BETA)

    def test_propose_without_targets_is_fed_back_once(self):
        store, nest, service = _bootstrap(workspace_session())
        with patched_llm([
            tool_resp('propose', {'summary': 's', 'goal': 'g', 'proposed_hierarchy': [{'title': 'E', 'features': []}]}),
            tool_resp('propose', {'summary': 's', 'goal': 'g', 'targets': [{'roadmap_id': BETA, 'proposed_hierarchy': [{'title': 'E', 'features': []}]}]}),
        ]):
            _ctx, result = _send(service, 'sess-ws', 'plan something')
        self.assertEqual(result.run.checkpoint, 'proposal')
        self.assertEqual(store.get('sess-ws').metadata.pending_plan.targets[0].roadmap_id, BETA)
        system = FakeLLM.calls[1]['messages'][0]['content']
        self.assertIn('PROPOSAL_TARGET_REQUIRED', system)


if __name__ == '__main__':
    unittest.main()

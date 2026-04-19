from __future__ import annotations

import unittest

from app.core.config import get_settings
from app.core.contracts.intents import EditSubIntent
from app.core.llm.planning.planner_output_estimator import (
    _EDIT_SUB_INTENT_DEFAULT_TOKENS,
    CommitEstimate,
    estimate_commit_output_tokens,
    extract_task_count_from_overview_summary,
    profile_ceiling_tokens,
    select_profile_for_estimate,
)


class EstimatorFromToolObservationsTests(unittest.TestCase):
    def test_bulk_update_with_24_targets_routes_to_default(self) -> None:
        # Mirrors the "assign all tasks to me" log scenario: helper
        # returned operations_count=1 and matched_task_count=24. The
        # estimator must pick `default` (2000), NOT `scoped_edit` (800).
        summary = [
            {
                'tool_name': 'bulk_update_tasks_by_filter',
                'result_summary': {
                    'operations_count': 1,
                    'matched_task_count': 24,
                    'updated_task_count': 24,
                },
            }
        ]
        estimate = estimate_commit_output_tokens(effective_tool_summary=summary)
        self.assertEqual(estimate.signal, 'tool_observations')
        self.assertGreater(estimate.tokens, 800)
        self.assertLess(estimate.tokens, 2000)
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent='status_change_only', settings=get_settings()
        )
        self.assertIsNone(profile, msg='default profile is represented as None')

    def test_bulk_update_with_100_targets_routes_to_repair_retry(self) -> None:
        summary = [
            {
                'result_summary': {
                    'operations_count': 1,
                    'matched_task_count': 100,
                },
            }
        ]
        estimate = estimate_commit_output_tokens(effective_tool_summary=summary)
        self.assertEqual(estimate.signal, 'tool_observations')
        self.assertGreater(estimate.tokens, 2000)
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertEqual(profile, 'repair_retry')

    def test_tool_observations_override_narrow_sub_intent(self) -> None:
        # Classifier tagged the intent as status_change_only but the
        # helper already observed 24 targets — the observation must win
        # over the sub-intent default so we don't under-size.
        summary = [{'result_summary': {'matched_task_count': 24}}]
        estimate = estimate_commit_output_tokens(
            effective_tool_summary=summary,
            edit_sub_intent='status_change_only',
        )
        self.assertEqual(estimate.signal, 'tool_observations')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent='status_change_only', settings=get_settings()
        )
        self.assertIsNone(profile, msg='must not pick scoped_edit when observed N is large')


class EstimatorFromBulkIntentTests(unittest.TestCase):
    def test_bulk_intent_with_small_roadmap_fits_default_profile(self) -> None:
        estimate = estimate_commit_output_tokens(
            bulk_intent_detected=True, roadmap_task_count=25
        )
        self.assertEqual(estimate.signal, 'bulk_intent')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertIsNone(profile)

    def test_bulk_intent_with_large_roadmap_routes_to_repair_retry(self) -> None:
        estimate = estimate_commit_output_tokens(
            bulk_intent_detected=True, roadmap_task_count=100
        )
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertEqual(profile, 'repair_retry')

    def test_bulk_intent_without_count_uses_safe_default(self) -> None:
        # Without a known task_count we still err on the wide side, so
        # the user doesn't eat a truncation + retry round.
        estimate = estimate_commit_output_tokens(bulk_intent_detected=True)
        self.assertEqual(estimate.signal, 'bulk_intent')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertEqual(profile, 'repair_retry')


class EstimatorFromSubIntentTests(unittest.TestCase):
    def test_sub_intent_default_alone_routes_to_default_not_scoped_edit(self) -> None:
        # Sub-intent classification alone is not strong enough evidence
        # for scoped_edit (800). Many "narrow" sub-intents turn out to
        # be bulk in disguise ("delete all my epics" classifies as
        # DELETE_ONLY but is 6 ops). Paying ~500 unused tokens on a
        # genuine single-op turn beats truncating and retrying.
        estimate = estimate_commit_output_tokens(edit_sub_intent='rename_only')
        self.assertEqual(estimate.signal, 'sub_intent_default')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent='rename_only', settings=get_settings()
        )
        self.assertIsNone(profile, msg='sub_intent_default alone must not pick scoped_edit')

    def test_scoped_edit_selected_when_single_op_evidence_confirms(self) -> None:
        # One resolve_node_reference with a single match + narrow
        # sub-intent = strong positive evidence of a single-op turn.
        summary = [
            {
                'tool_name': 'resolve_node_reference',
                'match_count': 1,
                'match_ids': ['00000000-0000-4000-8000-000000000001'],
            }
        ]
        estimate = estimate_commit_output_tokens(
            effective_tool_summary=summary, edit_sub_intent='rename_only'
        )
        self.assertEqual(estimate.signal, 'tool_observations')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent='rename_only', settings=get_settings()
        )
        self.assertEqual(profile, 'scoped_edit')

    def test_scoped_edit_never_selected_without_sub_intent(self) -> None:
        # The scoped_edit profile narrows the tool envelope + prompt
        # shape too. A small estimate alone is not enough.
        estimate = estimate_commit_output_tokens(edit_sub_intent=None)
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertIsNone(profile, msg='must never pick scoped_edit without sub_intent')


class EstimatorFromResolveObservationsTests(unittest.TestCase):
    def test_six_single_match_resolves_imply_six_ops(self) -> None:
        # Mirrors the "Delete all my epics" log scenario: the planner
        # fired six resolve_node_reference calls before the commit turn,
        # each with match_count=1. Previously the estimator saw zero
        # ops/targets and fell through to sub_intent_default → 800
        # ceiling → truncation. Now each confirmed single-match resolve
        # counts as one implied op + one implied target.
        summary = [
            {
                'tool_name': 'resolve_node_reference',
                'match_count': 1,
                'match_ids': [f'00000000-0000-4000-8000-00000000000{i}'],
            }
            for i in range(1, 7)
        ]
        estimate = estimate_commit_output_tokens(
            effective_tool_summary=summary,
            edit_sub_intent='delete_only',
        )
        self.assertEqual(estimate.signal, 'tool_observations')
        self.assertEqual(estimate.op_count, 6)
        self.assertGreaterEqual(estimate.target_count, 6)
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent='delete_only', settings=get_settings()
        )
        self.assertIsNone(profile, msg='six resolves must not squeeze into scoped_edit')

    def test_multi_match_resolve_does_not_count_as_op(self) -> None:
        # A resolve that returned multiple candidates is ambiguous — the
        # planner will typically clarify, not emit N ops. Don't inflate
        # the estimate based on disambiguation candidates.
        summary = [
            {
                'tool_name': 'resolve_node_reference',
                'match_count': 4,
                'match_ids': [f'00000000-0000-4000-8000-00000000000{i}' for i in range(4)],
            }
        ]
        estimate = estimate_commit_output_tokens(
            effective_tool_summary=summary, edit_sub_intent='rename_only'
        )
        # match_ids still contributes to targets via the list-length
        # path, but ops should NOT be bumped — the single resolve isn't
        # evidence of multiple ops.
        self.assertEqual(estimate.op_count, 1)

    def test_resolve_match_items_shape_also_counts(self) -> None:
        # Some summary builders emit `match_items` (list of dicts)
        # instead of `match_ids`. Both shapes should contribute.
        summary = [
            {
                'tool_name': 'resolve_node_reference',
                'match_count': 1,
                'match_items': [{'id': 'abc', 'title': 'x', 'type': 'epic', 'status': ''}],
            }
        ]
        estimate = estimate_commit_output_tokens(effective_tool_summary=summary)
        self.assertEqual(estimate.signal, 'tool_observations')
        self.assertGreaterEqual(estimate.target_count, 1)


class EstimatorFromStagedOpsTests(unittest.TestCase):
    def test_staged_ops_drive_estimate(self) -> None:
        estimate = estimate_commit_output_tokens(staged_operation_count=5)
        self.assertEqual(estimate.signal, 'tool_observations')
        self.assertEqual(estimate.op_count, 5)
        self.assertGreater(estimate.tokens, 400)


class EstimatorFallbackTests(unittest.TestCase):
    def test_fallback_when_no_signals(self) -> None:
        estimate = estimate_commit_output_tokens()
        self.assertEqual(estimate.signal, 'fallback')
        profile = select_profile_for_estimate(
            estimate, edit_sub_intent=None, settings=get_settings()
        )
        self.assertIsNone(profile)


class TaskCountExtractorTests(unittest.TestCase):
    def test_parses_task_count_from_summary_string(self) -> None:
        summary = (
            'Roadmap: "Untitled Roadmap" (status: draft)\n'
            '6 epics · 12 features · 25 tasks'
        )
        self.assertEqual(extract_task_count_from_overview_summary(summary), 25)

    def test_handles_singular_task(self) -> None:
        self.assertEqual(
            extract_task_count_from_overview_summary('1 epic · 1 feature · 1 task'),
            1,
        )

    def test_returns_none_for_missing_pattern(self) -> None:
        self.assertIsNone(
            extract_task_count_from_overview_summary('Roadmap: untitled')
        )
        self.assertIsNone(extract_task_count_from_overview_summary(None))
        self.assertIsNone(extract_task_count_from_overview_summary(123))


class EditSubIntentEnumTests(unittest.TestCase):
    def test_every_enum_member_has_default_tokens_entry(self) -> None:
        # Guards against adding a new sub-intent to the enum without
        # extending the estimator's default-tokens table.
        missing = [
            member for member in EditSubIntent
            if member not in _EDIT_SUB_INTENT_DEFAULT_TOKENS
        ]
        self.assertEqual(
            missing, [], msg=f'missing default tokens for: {missing}'
        )

    def test_enum_member_and_string_are_interchangeable_keys(self) -> None:
        # Str-Enum members hash equal to their string value so either
        # form of `edit_sub_intent` works.
        self.assertEqual(
            _EDIT_SUB_INTENT_DEFAULT_TOKENS.get(EditSubIntent.RENAME_ONLY),
            _EDIT_SUB_INTENT_DEFAULT_TOKENS.get('rename_only'),
        )


class ProfileCeilingTests(unittest.TestCase):
    def test_profile_ceilings_match_config(self) -> None:
        settings = get_settings()
        self.assertEqual(
            profile_ceiling_tokens('scoped_edit', settings=settings),
            settings.openai_edit_narrow_max_tokens,
        )
        self.assertEqual(
            profile_ceiling_tokens(None, settings=settings),
            settings.openai_edit_default_max_tokens,
        )
        self.assertEqual(
            profile_ceiling_tokens('default', settings=settings),
            settings.openai_edit_default_max_tokens,
        )
        self.assertEqual(
            profile_ceiling_tokens('repair_retry', settings=settings),
            settings.openai_edit_repair_max_tokens,
        )


class CommitEstimateShapeTests(unittest.TestCase):
    def test_estimate_is_immutable_dataclass(self) -> None:
        est = CommitEstimate(tokens=100, op_count=1, target_count=0, signal='fallback')
        with self.assertRaises(Exception):
            est.tokens = 200  # type: ignore[misc]


if __name__ == '__main__':
    unittest.main()

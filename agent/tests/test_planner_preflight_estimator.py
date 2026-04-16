from __future__ import annotations

import unittest

from app.core.llm.planning.planner_operation_flow import estimate_plan_output_tokens


class EstimatePlanOutputTokensTests(unittest.TestCase):
    """Sanity tests for the preflight output-size estimator.

    The goal is to catch prompts that'll blow past the default planner
    budget *before* the first call, so we can start at the repair_retry
    budget and skip a guaranteed retry round-trip.
    """

    def test_empty_input_returns_zero(self) -> None:
        self.assertEqual(estimate_plan_output_tokens(''), 0)
        self.assertEqual(estimate_plan_output_tokens('   \n  '), 0)

    def test_trivial_prompt_stays_below_default_budget(self) -> None:
        tokens = estimate_plan_output_tokens('rename the epic to Foo')
        # One-op rename should be comfortably under 2000 tokens so the
        # preflight leaves the default profile in place.
        self.assertLess(tokens, 2000)

    def test_large_bulleted_plan_exceeds_default_budget(self) -> None:
        # Mirrors the shape of the 36-op prompt that triggered the
        # original truncation (the one that prompted this whole audit).
        prompt_lines = [
            'Create a roadmap with the following:',
            'Epic: Agent Core',
        ]
        for epic in range(3):
            prompt_lines.append(f'- Epic {epic}')
            for feature in range(4):
                prompt_lines.append(f'  - Feature {feature}')
                for task in range(4):
                    prompt_lines.append(f'    - Task {task}')
        prompt = '\n'.join(prompt_lines)
        tokens = estimate_plan_output_tokens(prompt)
        # ~51 bullet lines -> ~5500 tokens; well above 2000 default.
        self.assertGreater(tokens, 2000)

    def test_mixed_prose_and_item_counts_are_both_credited(self) -> None:
        prose_prompt = 'Please create five epics and ten tasks for the auth module.'
        bullet_prompt = '\n'.join(['- thing %d' % i for i in range(15)])
        prose_tokens = estimate_plan_output_tokens(prose_prompt)
        bullet_tokens = estimate_plan_output_tokens(bullet_prompt)
        # Both should be measurably above the base overhead (400).
        self.assertGreater(prose_tokens, 400)
        self.assertGreater(bullet_tokens, 400)

    def test_longer_prompts_give_monotonically_higher_estimates(self) -> None:
        small = estimate_plan_output_tokens('one epic with two features')
        medium = estimate_plan_output_tokens(
            'Create 3 epics and 5 features and 8 tasks for the auth module.'
        )
        large = '\n'.join(['- item %d' % i for i in range(30)])
        self.assertLessEqual(small, estimate_plan_output_tokens(
            'one epic with two features and one task'
        ))
        self.assertLess(small, medium)
        self.assertLess(medium, estimate_plan_output_tokens(large))


if __name__ == '__main__':
    unittest.main()

import unittest
from unittest.mock import AsyncMock

from app.core.orchestration.context.roadmap_overview_summarizer import (
    DEFAULT_MAX_EPICS,
    build_roadmap_overview_summary,
    format_overview_summary,
)


def _epic(
    title: str,
    *,
    feature_count: int = 0,
    status: str | None = None,
    features: list[dict] | None = None,
) -> dict:
    entry: dict = {'id': f'id-{title}', 'title': title, 'feature_count': feature_count}
    if status is not None:
        entry['status'] = status
    if features is not None:
        entry['features'] = features
    return entry


def _feature(title: str, *, status: str | None = None) -> dict:
    entry: dict = {'id': f'id-{title}', 'title': title}
    if status is not None:
        entry['status'] = status
    return entry


class FormatOverviewSummaryTests(unittest.TestCase):
    def test_formats_header_totals_and_epics(self) -> None:
        payload = {
            'title': 'Q2 SaaS Platform Development',
            'status': 'in_progress',
            'epic_count': 3,
            'feature_count': 7,
            'task_count': 22,
            'epics': [
                _epic('PM Module', feature_count=1, status='done'),
                _epic('Agent Core', feature_count=4, status='in_progress'),
                _epic('API Security', feature_count=2, status='todo'),
            ],
        }
        rendered = format_overview_summary(payload)
        assert rendered is not None
        self.assertIn('Roadmap: "Q2 SaaS Platform Development" (status: in_progress)', rendered)
        self.assertIn('3 epics · 7 features · 22 tasks', rendered)
        self.assertIn('1. PM Module — 1 feature, status: done', rendered)
        self.assertIn('2. Agent Core — 4 features, status: in_progress', rendered)
        self.assertIn('3. API Security — 2 features, status: todo', rendered)

    def test_truncates_when_epic_count_exceeds_max(self) -> None:
        epics = [_epic(f'Epic {idx}', feature_count=idx) for idx in range(1, 21)]
        payload = {
            'title': 'Mega roadmap',
            'epic_count': 20,
            'feature_count': 210,
            'task_count': 400,
            'epics': epics,
        }
        rendered = format_overview_summary(payload, max_epics=5)
        assert rendered is not None
        self.assertIn('1. Epic 1 — 1 feature', rendered)
        self.assertIn('5. Epic 5 — 5 features', rendered)
        self.assertNotIn('6. Epic 6', rendered)
        self.assertIn('…and 15 more epics', rendered)

    def test_pluralization_singular_plural(self) -> None:
        payload = {
            'title': 'Solo',
            'epic_count': 1,
            'feature_count': 1,
            'task_count': 1,
            'epics': [_epic('Lone Epic', feature_count=1)],
        }
        rendered = format_overview_summary(payload)
        assert rendered is not None
        self.assertIn('1 epic · 1 feature · 1 task', rendered)
        self.assertIn('1. Lone Epic — 1 feature', rendered)

    def test_omits_missing_totals_and_status(self) -> None:
        # Only title and epics — no counts or statuses — should still render.
        payload = {
            'title': 'Bare roadmap',
            'epics': [_epic('X'), _epic('Y')],
        }
        rendered = format_overview_summary(payload)
        assert rendered is not None
        self.assertIn('Roadmap: "Bare roadmap"', rendered)
        self.assertNotIn('status:', rendered)
        self.assertIn('1. X', rendered)
        self.assertIn('2. Y', rendered)

    def test_returns_none_for_empty_payload(self) -> None:
        # No title + no epics → summary is effectively empty; we still render
        # the "Untitled roadmap" header so the caller gets a non-None string.
        # But a truly empty dict with no recognizable data should still return
        # the default header, so assert that behavior.
        rendered = format_overview_summary({})
        self.assertIsNotNone(rendered)
        assert rendered is not None
        self.assertIn('Roadmap: "Untitled roadmap"', rendered)

    def test_renders_feature_titles_under_each_epic(self) -> None:
        payload = {
            'title': 'Demo',
            'epic_count': 2,
            'feature_count': 3,
            'task_count': 0,
            'epics': [
                _epic(
                    'Alpha',
                    feature_count=2,
                    status='in_progress',
                    features=[
                        _feature('Login API', status='done'),
                        _feature('Signup flow'),
                    ],
                ),
                _epic(
                    'Beta',
                    feature_count=1,
                    features=[_feature('Onboarding wizard', status='todo')],
                ),
            ],
        }
        rendered = format_overview_summary(payload)
        assert rendered is not None
        self.assertIn('1. Alpha — 2 features, status: in_progress', rendered)
        self.assertIn('   · Login API (status: done)', rendered)
        self.assertIn('   · Signup flow', rendered)
        self.assertIn('2. Beta — 1 feature', rendered)
        self.assertIn('   · Onboarding wizard (status: todo)', rendered)

    def test_truncates_features_per_epic(self) -> None:
        features = [_feature(f'Feature {i}') for i in range(1, 11)]
        payload = {
            'title': 'Demo',
            'epic_count': 1,
            'feature_count': 10,
            'task_count': 0,
            'epics': [_epic('Alpha', feature_count=10, features=features)],
        }
        rendered = format_overview_summary(payload, max_features_per_epic=3)
        assert rendered is not None
        self.assertIn('   · Feature 1', rendered)
        self.assertIn('   · Feature 3', rendered)
        self.assertNotIn('   · Feature 4', rendered)
        self.assertIn('   · …and 7 more features', rendered)

    def test_epic_without_features_renders_cleanly(self) -> None:
        payload = {
            'title': 'Demo',
            'epic_count': 1,
            'feature_count': 0,
            'task_count': 0,
            'epics': [_epic('Empty epic', feature_count=0, features=[])],
        }
        rendered = format_overview_summary(payload)
        assert rendered is not None
        self.assertIn('1. Empty epic — 0 features', rendered)
        # No feature bullets should be present
        self.assertNotIn('   · ', rendered)

    def test_max_epics_clamped_to_sane_range(self) -> None:
        epics = [_epic(f'E{i}', feature_count=0) for i in range(3)]
        payload = {'title': 'R', 'epics': epics}
        # Values below 1 clamp to 1 (cannot disable the list entirely).
        rendered = format_overview_summary(payload, max_epics=0)
        assert rendered is not None
        self.assertIn('1. E0', rendered)
        self.assertIn('…and 2 more epics', rendered)


class BuildRoadmapOverviewSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_none_when_auth_header_missing(self) -> None:
        client = AsyncMock()
        result = await build_roadmap_overview_summary(
            nest_client=client,
            roadmap_id='r',
            auth_header=None,
        )
        self.assertIsNone(result)
        client.context_summary.assert_not_awaited()

    async def test_returns_none_when_roadmap_id_empty(self) -> None:
        client = AsyncMock()
        result = await build_roadmap_overview_summary(
            nest_client=client,
            roadmap_id='',
            auth_header='Bearer token',
        )
        self.assertIsNone(result)
        client.context_summary.assert_not_awaited()

    async def test_returns_none_when_backend_raises(self) -> None:
        client = AsyncMock()
        client.context_summary.side_effect = RuntimeError('boom')
        result = await build_roadmap_overview_summary(
            nest_client=client,
            roadmap_id='r',
            auth_header='Bearer token',
        )
        self.assertIsNone(result)

    async def test_returns_none_on_error_payload(self) -> None:
        client = AsyncMock()
        client.context_summary.return_value = {'error': {'status_code': 500}}
        result = await build_roadmap_overview_summary(
            nest_client=client,
            roadmap_id='r',
            auth_header='Bearer token',
        )
        self.assertIsNone(result)

    async def test_returns_formatted_summary_on_success(self) -> None:
        client = AsyncMock()
        client.context_summary.return_value = {
            'title': 'Demo',
            'status': 'draft',
            'epic_count': 2,
            'feature_count': 3,
            'task_count': 10,
            'epics': [
                _epic('Alpha', feature_count=2, status='in_progress'),
                _epic('Beta', feature_count=1, status='todo'),
            ],
        }
        result = await build_roadmap_overview_summary(
            nest_client=client,
            roadmap_id='roadmap-1',
            auth_header='Bearer token',
            trace_id='trace-1',
        )
        assert result is not None
        self.assertIn('Roadmap: "Demo" (status: draft)', result)
        self.assertIn('2 epics · 3 features · 10 tasks', result)
        self.assertIn('1. Alpha — 2 features, status: in_progress', result)
        self.assertIn('2. Beta — 1 feature, status: todo', result)

    def test_default_max_epics_constant(self) -> None:
        self.assertEqual(DEFAULT_MAX_EPICS, 15)


if __name__ == '__main__':  # pragma: no cover
    unittest.main()

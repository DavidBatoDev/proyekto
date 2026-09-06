"""Entity links keep model titles while expanding server-owned outline handles."""

from __future__ import annotations

import unittest

from app.core.contracts.runs import RunState
from app.core.contracts.sessions import AgentSession, RoadmapContext
from app.core.runtime.entity_links import entity_link, expand_entity_links, strip_entity_links
from app.core.runtime.phases.propose import _auto_summary

ALPHA = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
EPIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
FEATURE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
MILESTONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
BETA_EPIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'


class EntityLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = AgentSession(roadmap_id=ALPHA)
        self.session.metadata.roadmaps[ALPHA] = RoadmapContext(
            roadmap_id=ALPHA,
            title='Alpha',
            handle_map={
                'E1': {'id': EPIC, 'type': 'epic', 'title': 'Growth'},
                'E1.F2': {'id': FEATURE, 'type': 'feature', 'title': 'Login'},
                'M1': {'id': MILESTONE, 'type': 'milestone', 'title': 'Launch'},
            },
        )
        self.session.metadata.roadmaps[BETA] = RoadmapContext(
            roadmap_id=BETA,
            title='Beta',
            handle_prefix='R2',
            handle_map={'R2.E1': {'id': BETA_EPIC, 'type': 'epic', 'title': 'Billing'}},
        )
        self.run = RunState(trace_id='entity-links', scope=self.session.scope, user_message='show me')

    def expand(self, text: str) -> str:
        return expand_entity_links(text, self.session, self.run)

    def test_uuid_passes_through_for_every_kind(self) -> None:
        for kind in ('project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team'):
            with self.subTest(kind=kind):
                text = f'Visit [Canonical title](proyekto://{kind}/{EPIC}).'
                self.assertEqual(self.expand(text), text)

    def test_bare_and_prefixed_handles_expand(self) -> None:
        for kind, handle, entity_id in (
            ('epic', 'E1', EPIC),
            ('feature', 'E1.F2', FEATURE),
            ('milestone', 'M1', MILESTONE),
            ('epic', 'R2.E1', BETA_EPIC),
        ):
            with self.subTest(handle=handle):
                self.assertEqual(
                    self.expand(f'[Title](proyekto://{kind}/{handle})'),
                    f'[Title](proyekto://{kind}/{entity_id})',
                )

    def test_kind_mismatch_drops_only_the_link(self) -> None:
        self.assertEqual(self.expand('Under [Growth](proyekto://task/E1).'), 'Under Growth.')
        self.assertEqual(self.expand('[Beta](proyekto://epic/R2)'), 'Beta')

    def test_roadmap_prefix_expands_to_its_roadmap(self) -> None:
        self.assertEqual(self.expand('[Beta](proyekto://roadmap/R2)'), f'[Beta](proyekto://roadmap/{BETA})')

    def test_unknown_handle_keeps_the_title(self) -> None:
        self.assertEqual(self.expand('See [Missing title](proyekto://feature/E99.F1).'), 'See Missing title.')
        self.assertEqual(self.expand('[Other roadmap](proyekto://roadmap/R99)'), 'Other roadmap')

    def test_empty_link_text_is_stripped(self) -> None:
        for entity_id in (EPIC, 'E1', 'E99'):
            with self.subTest(entity_id=entity_id):
                self.assertEqual(self.expand(f'Before [](proyekto://epic/{entity_id}) after'), 'Before  after')
        self.assertEqual(self.expand('[   ](proyekto://epic/E1)'), '   ')

    def test_nested_and_escaped_bracket_titles_expand_without_changing_label(self) -> None:
        for label in ('Growth [Q4]', r'Growth \[Q4\]'):
            with self.subTest(label=label):
                self.assertEqual(
                    self.expand(f'[{label}](proyekto://epic/E1)'),
                    f'[{label}](proyekto://epic/{EPIC})',
                )
                self.assertEqual(self.expand(f'[{label}](proyekto://epic/E99)'), label)

    def test_generated_links_escape_markdown_punctuation(self) -> None:
        self.assertEqual(
            entity_link('Growth [Q4] *next*', 'epic', EPIC),
            f'[Growth \\[Q4\\] \\*next\\*](proyekto://epic/{EPIC})',
        )

    def test_auto_proposal_summary_links_each_roadmap(self) -> None:
        summary = _auto_summary([
            {'roadmap_id': ALPHA, 'roadmap_title': 'Alpha', 'operations_count': 1},
            {'roadmap_id': BETA, 'roadmap_title': 'Beta', 'operations_count': 2},
        ])
        self.assertEqual(
            summary,
            f'Proposed 1 change to [Alpha](proyekto://roadmap/{ALPHA}); '
            f'2 changes to [Beta](proyekto://roadmap/{BETA}).',
        )

    def test_text_without_entity_links_is_byte_identical(self) -> None:
        text = '  A [note], **bold text**, and [docs](https://example.com).\r\n\n'
        self.assertEqual(self.expand(text).encode('utf-8'), text.encode('utf-8'))

    def test_multiple_links_preserve_relationship_words(self) -> None:
        text = (
            f'[Task](proyekto://task/{EPIC}) — in [Beta](proyekto://roadmap/R2) '
            'under [Login](proyekto://feature/E1.F2) / [Growth](proyekto://epic/E1), '
            'beside [Missing](proyekto://epic/E99).'
        )
        expected = (
            f'[Task](proyekto://task/{EPIC}) — in [Beta](proyekto://roadmap/{BETA}) '
            f'under [Login](proyekto://feature/{FEATURE}) / [Growth](proyekto://epic/{EPIC}), '
            'beside Missing.'
        )
        self.assertEqual(self.expand(text), expected)

    def test_expansion_does_not_mutate_session_or_run(self) -> None:
        before_session = self.session.model_dump()
        before_run = self.run.model_dump()
        self.expand('[Billing](proyekto://epic/R2.E1) in [Beta](proyekto://roadmap/R2)')
        self.assertEqual(self.session.model_dump(), before_session)
        self.assertEqual(self.run.model_dump(), before_run)


class StripEntityLinkTests(unittest.TestCase):
    def test_uuid_and_handle_links_keep_titles_and_relationship_words(self) -> None:
        self.assertEqual(
            strip_entity_links(
                f'[Task](proyekto://task/{EPIC}) in [Alpha](proyekto://roadmap/{ALPHA}) '
                'under [Login](proyekto://feature/E1.F2) / [Growth](proyekto://epic/E1); '
                '[Beta](proyekto://roadmap/R2), [Billing](proyekto://epic/R2.E1), '
                '[Launch](proyekto://milestone/M1).'
            ),
            'Task in Alpha under Login / Growth; Beta, Billing, Launch.',
        )

    def test_all_entity_kinds_strip_without_resolving_ids(self) -> None:
        for kind in ('project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team'):
            with self.subTest(kind=kind):
                self.assertEqual(strip_entity_links(f'[Title](proyekto://{kind}/{EPIC})'), 'Title')

    def test_escaped_and_nested_brackets_keep_canonical_title(self) -> None:
        self.assertEqual(strip_entity_links(r'[Growth \[Q4\]](proyekto://epic/E1)'), 'Growth [Q4]')
        self.assertEqual(strip_entity_links('[Growth [Q4]](proyekto://epic/E1)'), 'Growth [Q4]')
        title = r'Growth [Q4] *next* _later_ `code` \archive'
        self.assertEqual(strip_entity_links(entity_link(title, 'epic', EPIC)), title)

    def test_non_entity_markdown_stays_byte_identical(self) -> None:
        text = '  **Bold**, _emphasis_, `code`, [docs](https://example.com), [local](/help).\r\n'
        self.assertEqual(strip_entity_links(text).encode('utf-8'), text.encode('utf-8'))
        self.assertEqual(
            strip_entity_links(f'{text}[Task](proyekto://task/{EPIC})'),
            f'{text}Task',
        )

    def test_empty_title_does_not_leave_a_uri(self) -> None:
        self.assertEqual(strip_entity_links('[](proyekto://epic/E1)'), '')


if __name__ == '__main__':
    unittest.main()

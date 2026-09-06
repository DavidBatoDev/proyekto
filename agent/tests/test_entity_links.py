"""Entity links keep model titles while expanding server-owned outline handles."""

from __future__ import annotations

import unittest

from app.core.contracts.runs import RunState
from app.core.contracts.sessions import AgentSession, RoadmapContext
from app.core.runtime.entity_links import entity_link, expand_entity_links, ground_entity_links, strip_entity_links
from app.core.runtime.entity_registry import register, register_many
from app.core.runtime.phases.propose import _auto_summary

ALPHA = '11111111-1111-1111-1111-111111111111'
BETA = '22222222-2222-2222-2222-222222222222'
EPIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
FEATURE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
MILESTONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
BETA_EPIC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
TASK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'


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

    def test_registered_uuid_passes_through_for_every_kind(self) -> None:
        for kind in ('project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team', 'workspace'):
            with self.subTest(kind=kind):
                register(self.run, kind, TASK, 'Canonical title')
                text = f'Visit [Canonical title](proyekto://{kind}/{TASK}).'
                self.assertEqual(self.expand(text), text)

    def test_bare_and_prefixed_handles_expand(self) -> None:
        for kind, handle, entity_id, title in (
            ('epic', 'E1', EPIC, 'Growth'),
            ('feature', 'E1.F2', FEATURE, 'Login'),
            ('milestone', 'M1', MILESTONE, 'Launch'),
            ('epic', 'R2.E1', BETA_EPIC, 'Billing'),
        ):
            with self.subTest(handle=handle):
                self.assertEqual(
                    self.expand(f'[{title}](proyekto://{kind}/{handle})'),
                    f'[{title}](proyekto://{kind}/{entity_id})',
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
        register(self.run, 'epic', EPIC, 'Growth [Q4]')
        for label in ('Growth [Q4]', r'Growth \[Q4\]'):
            with self.subTest(label=label):
                self.assertEqual(
                    self.expand(f'[{label}](proyekto://epic/E1)'),
                    f'[{label}](proyekto://epic/{EPIC})',
                )
                self.assertEqual(self.expand(f'[{label}](proyekto://epic/E99)'), 'Growth [Q4]')

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
        register(self.run, 'task', TASK, 'Task')
        text = (
            f'[Task](proyekto://task/{TASK}) — in [Beta](proyekto://roadmap/R2) '
            'under [Login](proyekto://feature/E1.F2) / [Growth](proyekto://epic/E1), '
            'beside [Missing](proyekto://epic/E99).'
        )
        expected = (
            f'[Task](proyekto://task/{TASK}) — in [Beta](proyekto://roadmap/{BETA}) '
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

    def test_grounding_counts_and_reasons(self) -> None:
        result = ground_entity_links(
            f'[Growth](proyekto://epic/E1), [Billing](proyekto://epic/{BETA_EPIC}), '
            f'[Unknown](proyekto://task/{TASK}), [Wrong kind](proyekto://team/{EPIC}), '
            f'[Wrong title](proyekto://epic/{EPIC})', self.session, self.run,
        )
        self.assertEqual(result.expanded, 1)
        self.assertEqual(result.kept, 2)
        self.assertEqual([row['reason'] for row in result.rejected], ['UNKNOWN_ID', 'KIND_MISMATCH', 'TITLE_MISMATCH'])
        self.assertIn('Unknown, Wrong kind, Wrong title', result.text)

    def test_prefix_and_long_containment_agree_but_short_names_do_not(self) -> None:
        register(self.run, 'epic', EPIC, '(Month 1) Supply network baseline')
        for title in ('Supply network baseline', 'Supply network baseline planning'):
            result = ground_entity_links(entity_link(title, 'epic', EPIC), self.session, self.run)
            self.assertEqual(result.kept, 1)
        register(self.run, 'epic', EPIC, 'Test Project')
        result = ground_entity_links(entity_link('Test', 'epic', EPIC), self.session, self.run)
        self.assertEqual(result.text, 'Test')
        self.assertEqual(result.rejected[0]['reason'], 'TITLE_MISMATCH')

    def test_rejection_is_logged_and_does_not_mutate_session_or_run(self) -> None:
        before_session, before_run = self.session.model_dump(), self.run.model_dump()
        with self.assertLogs('app.core.runtime.entity_links', level='INFO') as logs:
            result = ground_entity_links(entity_link('Wrong title', 'epic', EPIC), self.session, self.run)
        self.assertEqual(result.rejected[0]['registered_title'], 'Growth')
        self.assertIn('ENTITY_LINK_REJECTED', '\n'.join(logs.output).upper())
        self.assertIn('TITLE_MISMATCH', '\n'.join(logs.output))
        self.assertEqual(self.session.model_dump(), before_session)
        self.assertEqual(self.run.model_dump(), before_run)

    def test_log_derived_reply_corpus(self) -> None:
        # Frozen replies reconstructed from ASSISTANT_DELTA in agent/logs.txt
        # on 2026-09-06: 18:56/19:15 bad roots, three good 19:14 task/epic replies.
        # Titles below are fixture ground truth, not derived from reply links.
        from app.core.contracts.runs import EntitySeen

        roadmap = '0c7d5bdc-6614-4f9d-b4f0-d8501a0c041b'
        team = 'f4004aa2-25a1-4e2e-89ed-e7bb94d81f17'
        project = '5cc20839-afb9-4cd4-81cf-4057c9ca7a2d'
        task = '7bbe9aa9-0ef9-4aec-a3ad-03a89512e6b2'
        epic = 'ec4506f7-39a4-488e-9a22-33403df62423'
        feature = 'a1218b09-2a0f-4562-892d-96f6ebba3b9f'
        supply = '3d13d05f-9f7b-45c4-bfc9-6c3b2960293f'
        risk = '8da246eb-add5-45ef-b58f-945f4387edb4'
        resilience = '2459ffbc-482b-4be8-8f53-7d8df188b5de'
        monitoring = '2f88157f-3eb3-47ef-b7e1-02ad1abbcf3e'
        improvement = '642dbb6e-fe74-4c98-91c5-dbf858caf498'
        register_many(self.run, [
            EntitySeen(kind='roadmap', id=roadmap, title='SaaS Launch System'),
            EntitySeen(kind='team', id=team, title='Claude Maxxing'),
            EntitySeen(kind='project', id=project, title="David's Workspace"),
            EntitySeen(kind='task', id=task, title='Complete the deliverable and run a peer review'),
            EntitySeen(kind='epic', id=epic, title='(Month 1) Supply network baseline'),
            EntitySeen(kind='feature', id=feature, title='Week 1 — Supply network baseline planning'),
            EntitySeen(kind='roadmap', id=supply, title='Supply Chain Resilience Program'),
            EntitySeen(kind='epic', id=risk, title='Risk and scenario analysis'),
            EntitySeen(kind='epic', id=resilience, title='Resilience interventions'),
            EntitySeen(kind='epic', id=monitoring, title='Monitoring and response'),
            EntitySeen(kind='epic', id=improvement, title='Continuous improvement'),
            EntitySeen(kind='project', id='cafc1c7a-d70b-4a22-98a2-94a04dc628b5', title='Dev QA — Client Engagement'),
            EntitySeen(kind='project', id='22222222-3333-4444-8555-666666666666', title='PW Drag Fixtures'),
            EntitySeen(kind='roadmap', id='22222222-3333-4444-8555-000000000001', title='PW Drag A'),
            EntitySeen(kind='project', id='fe8fe922-bd41-4233-bb05-397086b8fc16', title='Test'),
            EntitySeen(kind='roadmap', id='c5a8ca27-e238-4d6c-a7b0-006b4c87e55e', title='Test'),
            EntitySeen(kind='roadmap', id='11111111-2222-4333-8444-666666666666', title='PW Perf Baseline'),
            EntitySeen(kind='roadmap', id='5c3cc60a-f3b4-4426-ac9b-ca631e3f865d', title='New Roadmap'),
            EntitySeen(kind='roadmap', id='22222222-3333-4444-8555-000000000002', title='PW Drag B'),
            EntitySeen(kind='roadmap', id='9c64dfdb-e0f5-48c1-88d0-cf55db18c043', title='Test Project'),
        ])
        bad_roadmap_reply = f"""You have 4 projects and 8 accessible roadmaps in [David's Workspace](proyekto://roadmap/{roadmap}).

### Projects
- [Dev QA — Client Engagement](proyekto://project/cafc1c7a-d70b-4a22-98a2-94a04dc628b5) — roadmap: [Supply Chain Resilience Program](proyekto://roadmap/{supply}), draft, 5 epics / 15 features / 30 tasks
- [PW Drag Fixtures](proyekto://project/22222222-3333-4444-8555-666666666666) — roadmap: [PW Drag A](proyekto://roadmap/22222222-3333-4444-8555-000000000001), draft, 4 epics / 1 feature / 2 tasks
- [Test](proyekto://project/fe8fe922-bd41-4233-bb05-397086b8fc16) — roadmap: [Test](proyekto://roadmap/c5a8ca27-e238-4d6c-a7b0-006b4c87e55e), draft, 1 epic / 0 features / 0 tasks
- [David's Workspace](proyekto://project/{project}) — roadmap: [SaaS Launch System](proyekto://roadmap/{roadmap}), draft, 2 epics / 0 features / 0 tasks

### Standalone roadmaps
- [PW Perf Baseline](proyekto://roadmap/11111111-2222-4333-8444-666666666666) — 60 epics / 180 features / 2 tasks, 1 open task
- [New Roadmap](proyekto://roadmap/5c3cc60a-f3b4-4426-ac9b-ca631e3f865d) — empty
- [PW Drag B](proyekto://roadmap/22222222-3333-4444-8555-000000000002) — 4 epics / 1 feature / 1 task
- [Test Project](proyekto://roadmap/9c64dfdb-e0f5-48c1-88d0-cf55db18c043) — empty

If you want, I can also turn this into a prioritized view, e.g. “what’s most active,” “what’s empty,” or “what’s due/blocked.”"""
        bad_team_reply = f"""Here’s a quick summary of what you can access in [David's Workspace](proyekto://team/{team}):

### Projects
- [Dev QA — Client Engagement](proyekto://project/cafc1c7a-d70b-4a22-98a2-94a04dc628b5) — has the [Supply Chain Resilience Program](proyekto://roadmap/{supply}) roadmap; 5 epics, 15 features, 30 tasks
- [PW Drag Fixtures](proyekto://project/22222222-3333-4444-8555-666666666666) — has the [PW Drag A](proyekto://roadmap/22222222-3333-4444-8555-000000000001) roadmap; 4 epics, 1 feature, 2 tasks
- [Test](proyekto://project/fe8fe922-bd41-4233-bb05-397086b8fc16) — has the [Test](proyekto://roadmap/c5a8ca27-e238-4d6c-a7b0-006b4c87e55e) roadmap; 1 epic, no features or tasks
- [David's Workspace](proyekto://project/{project}) — has the [SaaS Launch System](proyekto://roadmap/{roadmap}) roadmap; 2 epics, no features or tasks

### Standalone roadmaps
- [PW Perf Baseline](proyekto://roadmap/11111111-2222-4333-8444-666666666666) — 60 epics, 180 features, 2 tasks
- [New Roadmap](proyekto://roadmap/5c3cc60a-f3b4-4426-ac9b-ca631e3f865d) — empty
- [PW Drag B](proyekto://roadmap/22222222-3333-4444-8555-000000000002) — 4 epics, 1 feature, 1 task
- [Test Project](proyekto://roadmap/9c64dfdb-e0f5-48c1-88d0-cf55db18c043) — empty

### At a glance
- 4 projects
- 8 roadmaps total
- 4 project-linked roadmaps
- 4 standalone roadmaps

If you want, I can also break these down by status, show your most active roadmap, or list just the ones with open work."""
        corpus = [
            (bad_roadmap_reply, 12, 1),
            (bad_team_reply, 12, 1),
            (f'You have 1 open assigned task:\n\n- [Complete the deliverable and run a peer review](proyekto://task/{task}) — due 2026-09-10, in [Supply Chain Resilience Program](proyekto://roadmap/{supply}), under [(Month 1) Supply network baseline](proyekto://epic/{epic}) / [(Week 1) Supply network baseline planning](proyekto://feature/{feature}).', 4, 0),
            (f'[Complete the deliverable and run a peer review](proyekto://task/{task}) is assigned to August Teleg and David Bato, and it sits under [Week 1 — Supply network baseline planning](proyekto://feature/{feature}) within [Supply network baseline](proyekto://epic/{epic}).', 3, 0),
            (f'The epics in [Supply Chain Resilience Program](proyekto://roadmap/{supply}) are:\n\n- [Supply network baseline](proyekto://epic/{epic})\n- [Risk and scenario analysis](proyekto://epic/{risk})\n- [Resilience interventions](proyekto://epic/{resilience})\n- [Monitoring and response](proyekto://epic/{monitoring})\n- [Continuous improvement](proyekto://epic/{improvement})', 6, 0),
        ]
        for text, kept, rejected in corpus:
            with self.subTest(text=text):
                result = ground_entity_links(text, self.session, self.run)
                self.assertEqual((result.kept, len(result.rejected)), (kept, rejected))
                if rejected:
                    self.assertEqual(result.rejected[0]['reason'], 'TITLE_MISMATCH')
                    self.assertIn("David's Workspace", result.text.splitlines()[0])
                    self.assertNotIn('proyekto:', result.text.splitlines()[0])
                else:
                    self.assertEqual(result.text, text)


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
        for kind in ('project', 'roadmap', 'epic', 'feature', 'task', 'milestone', 'team', 'workspace'):
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

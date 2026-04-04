import unittest

from app.core.contracts.operations import RoadmapOperation
from app.core.contracts.sessions import AgentSession, DraftNode, MessageResponse, SessionMetadata


class DraftGraphVersioningContractTests(unittest.TestCase):
    def test_session_metadata_defaults_include_draft_graph_fields(self) -> None:
        metadata = SessionMetadata()

        self.assertEqual(metadata.drafts, {})
        self.assertEqual(metadata.draft_head_ids, [])
        self.assertEqual(metadata.applied_draft_commits, [])
        self.assertIsNone(metadata.active_draft_id)

    def test_agent_session_legacy_payload_deserializes_with_draft_defaults(self) -> None:
        payload = {
            'session_id': 'a0d564bb-6d6f-4f38-8d08-8a86ecfd0402',
            'roadmap_id': 'roadmap-1',
            'operations': [
                {
                    'op': 'update_node',
                    'node_id': '11111111-1111-1111-1111-111111111111',
                    'patch': {'title': 'Legacy'},
                }
            ],
            'staged_operations_version': 2,
            'artifacts': [],
            'messages': [],
            'metadata': {},
        }

        session = AgentSession.model_validate(payload)

        self.assertEqual(session.staged_operations_version, 2)
        self.assertEqual(len(session.operations), 1)
        self.assertEqual(session.metadata.drafts, {})
        self.assertIsNone(session.metadata.active_draft_id)

    def test_draft_node_roundtrip_keeps_operations(self) -> None:
        node = DraftNode(
            draft_id='draft-1',
            operations=[
                RoadmapOperation(
                    op='update_node',
                    node_id='dad5697a-8962-4f80-8bc3-8a964edd8e56',
                    patch={'title': 'Platform Foundation'},
                )
            ],
            draft_version=3,
        )

        dumped = node.model_dump(mode='json')
        restored = DraftNode.model_validate(dumped)

        self.assertEqual(restored.draft_id, 'draft-1')
        self.assertEqual(restored.draft_version, 3)
        self.assertEqual(len(restored.operations), 1)
        self.assertEqual(restored.operations[0].op.value, 'update_node')

    def test_message_response_defaults_for_new_draft_fields(self) -> None:
        response = MessageResponse(
            session_id='session-1',
            assistant_message='ok',
            parse_mode='openai_tool_calling',
            intent_type='roadmap_edit',
            response_mode='edit_plan',
            operations=[],
            preview_available=False,
            preview_recommended=False,
            staged_operations_version=0,
            staged_operations_count=0,
        )

        self.assertIsNone(response.active_draft_id)
        self.assertIsNone(response.active_draft_version)


if __name__ == '__main__':
    unittest.main()

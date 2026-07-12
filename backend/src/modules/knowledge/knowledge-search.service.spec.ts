import { KnowledgeSearchService } from './knowledge-search.service';

class ParticipantsQuery {
  __rows: Array<{ room_id: string }> = [];
  select = jest.fn().mockReturnThis();
  eq = jest.fn().mockReturnThis();
  then(
    onFulfilled: (result: { data: unknown; error: unknown }) => unknown,
    onRejected?: (err: unknown) => unknown,
  ) {
    return Promise.resolve({ data: this.__rows, error: null }).then(
      onFulfilled,
      onRejected,
    );
  }
}

const buildService = ({
  embeddingsEnabled = true,
  rooms = [] as string[],
  rpcRows = [] as Array<Record<string, unknown>>,
} = {}) => {
  const participants = new ParticipantsQuery();
  participants.__rows = rooms.map((room_id) => ({ room_id }));
  const db = {
    from: jest.fn().mockReturnValue(participants),
    rpc: jest.fn(() => Promise.resolve({ data: rpcRows, error: null })),
  };
  const embeddings = {
    isEnabled: jest.fn().mockReturnValue(embeddingsEnabled),
    embedBatch: jest.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => (embeddingsEnabled ? [0.5, 0.5] : null))),
    ),
    toVectorLiteral: jest.fn((v: number[]) => JSON.stringify(v)),
  };
  const service = new KnowledgeSearchService(db as never, embeddings as never);
  return { service, db, embeddings, participants };
};

describe('KnowledgeSearchService', () => {
  it('guests search with an empty room list (no chat visibility)', async () => {
    const { service, db } = buildService();

    await service.search({
      projectId: 'project-1',
      userId: 'guest-1',
      isGuest: true,
      query: 'payments',
    });

    expect(db.from).not.toHaveBeenCalled(); // no participant lookup
    expect(db.rpc).toHaveBeenCalledWith(
      'search_knowledge_chunks',
      expect.objectContaining({ p_room_ids: [] }),
    );
  });

  it('members forward their chat_room_participants rooms and clamp the limit', async () => {
    const { service, db, participants } = buildService({
      rooms: ['room-1', 'room-2'],
    });

    await service.search({
      projectId: 'project-1',
      userId: 'user-1',
      isGuest: false,
      query: 'payments',
      sources: ['chat_message'],
      limit: 99,
    });

    expect(participants.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(participants.eq).toHaveBeenCalledWith(
      'chat_rooms.project_id',
      'project-1',
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'search_knowledge_chunks',
      expect.objectContaining({
        p_room_ids: ['room-1', 'room-2'],
        p_source_types: ['chat_message'],
        p_limit: 20,
        p_embedding: '[0.5,0.5]',
      }),
    );
  });

  it('uses the text-only lane when embeddings are disabled', async () => {
    const { service, db } = buildService({ embeddingsEnabled: false });

    await service.search({
      projectId: 'project-1',
      userId: 'user-1',
      isGuest: false,
      query: 'payments',
    });

    expect(db.rpc).toHaveBeenCalledWith(
      'search_knowledge_chunks',
      expect.objectContaining({ p_embedding: null, p_source_types: null }),
    );
  });

  it('trims oversized result contents for transport', async () => {
    const { service } = buildService({
      rpcRows: [
        { id: 'c1', content: 'y'.repeat(2_000), score: 0.4 },
        { id: 'c2', content: 'short', score: 0.3 },
      ],
    });

    const results = await service.search({
      projectId: 'project-1',
      userId: 'user-1',
      isGuest: false,
      query: 'payments',
    });

    expect(results[0].content).toHaveLength(1_501); // 1500 + ellipsis
    expect(results[1].content).toBe('short');
  });

  it('matchRelevantMemories returns null when embeddings are disabled', async () => {
    const { service, db } = buildService({ embeddingsEnabled: false });

    await expect(
      service.matchRelevantMemories({
        roadmapId: 'rm-1',
        projectId: 'project-1',
        query: 'demos',
        limit: 8,
      }),
    ).resolves.toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('matchRelevantMemories calls the SQL function with the roadmap/project pair', async () => {
    const { service, db } = buildService({
      rpcRows: [{ id: 'm1', content: 'rule', similarity: 0.9 }],
    });

    const rows = await service.matchRelevantMemories({
      roadmapId: 'rm-1',
      projectId: null,
      query: 'demos',
      limit: 50,
    });

    expect(rows).toHaveLength(1);
    expect(db.rpc).toHaveBeenCalledWith(
      'match_relevant_memories',
      expect.objectContaining({
        p_roadmap: 'rm-1',
        p_project: null,
        p_limit: 20,
      }),
    );
  });
});

import { KnowledgeIngestService } from './knowledge-ingest.service';

type OutboxRowFixture = {
  id: number;
  source_type: string;
  source_id: string;
  project_id: string | null;
  op: 'upsert' | 'delete';
  attempts: number;
};

class QueryBuilder {
  __resolveData: unknown = null;
  __resolveError: { message: string } | null = null;
  select = jest.fn().mockReturnThis();
  insert = jest.fn().mockImplementation(() => this);
  update = jest.fn().mockImplementation(() => this);
  delete = jest.fn().mockReturnThis();
  eq = jest.fn().mockReturnThis();
  maybeSingle = jest.fn().mockImplementation(() =>
    Promise.resolve({
      data: this.__resolveData,
      error: this.__resolveError,
    }),
  );
  then(
    onFulfilled: (result: { data: unknown; error: unknown }) => unknown,
    onRejected?: (err: unknown) => unknown,
  ) {
    return Promise.resolve({
      data: this.__resolveData,
      error: this.__resolveError,
    }).then(onFulfilled, onRejected);
  }
}

const buildService = ({
  outboxBatches = [[]],
  tables = {},
  embeddingsEnabled = true,
  ingestEnabled = true,
}: {
  outboxBatches?: OutboxRowFixture[][];
  tables?: Record<string, QueryBuilder[]>;
  embeddingsEnabled?: boolean;
  ingestEnabled?: boolean;
} = {}) => {
  const remainingBatches = [...outboxBatches, []];
  const remainingBuilders = new Map(
    Object.entries(tables).map(([table, builders]) => [table, [...builders]]),
  );
  const db = {
    rpc: jest.fn(() =>
      Promise.resolve({ data: remainingBatches.shift(), error: null }),
    ),
    from: jest.fn((table: string) => {
      const builder = remainingBuilders.get(table)?.shift();
      if (!builder) throw new Error(`Unexpected query for ${table}`);
      return builder;
    }),
  };
  const embeddings = {
    isEnabled: jest.fn().mockReturnValue(embeddingsEnabled),
    embedBatch: jest.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => (embeddingsEnabled ? [0.1, 0.2] : null))),
    ),
    toVectorLiteral: jest.fn((v: number[]) => JSON.stringify(v)),
  };
  const outbox = { isEnabled: jest.fn().mockReturnValue(ingestEnabled) };
  const service = new KnowledgeIngestService(
    db as never,
    embeddings as never,
    outbox as never,
  );
  return { service, db, embeddings };
};

const outboxRow = (
  overrides: Partial<OutboxRowFixture> = {},
): OutboxRowFixture => ({
  id: 1,
  source_type: 'chat_message',
  source_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  project_id: null,
  op: 'upsert',
  attempts: 1,
  ...overrides,
});

const chatMessage = (overrides: Record<string, unknown> = {}) => {
  const builder = new QueryBuilder();
  builder.__resolveData = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    room_id: 'room-1',
    project_id: 'project-1',
    sender_id: 'user-1',
    content: 'We decided to use Stripe for payments.',
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    sender: { display_name: 'Ada' },
    room: { name: 'general', slug: 'general' },
    ...overrides,
  };
  return builder;
};

describe('KnowledgeIngestService', () => {
  it('short-circuits when the flag is off', async () => {
    const { service, db } = buildService({ ingestEnabled: false });
    await expect(service.runIngest()).resolves.toMatchObject({
      skipped: true,
      claimed: 0,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('ingests a chat message: derives scope from the source row and embeds', async () => {
    const deleteBuilder = new QueryBuilder();
    const insertBuilder = new QueryBuilder();
    const markBuilder = new QueryBuilder();
    const { service, embeddings } = buildService({
      outboxBatches: [[outboxRow()]],
      tables: {
        chat_room_messages: [chatMessage()],
        ai_knowledge_chunks: [deleteBuilder, insertBuilder],
        ai_knowledge_outbox: [markBuilder],
      },
    });

    const result = await service.runIngest();

    expect(result).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
    expect(embeddings.embedBatch).toHaveBeenCalledWith([
      'We decided to use Stripe for payments.',
    ]);
    const insertCalls = insertBuilder.insert.mock.calls as unknown as [
      Array<Record<string, unknown>>,
    ][];
    const inserted = insertCalls[0][0];
    expect(inserted[0]).toMatchObject({
      project_id: 'project-1',
      room_id: 'room-1',
      source_type: 'chat_message',
      chunk_index: 0,
      embedding: '[0.1,0.2]',
    });
    expect((inserted[0].metadata as Record<string, unknown>).sender_name).toBe(
      'Ada',
    );
    expect(markBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ last_error: null }),
    );
  });

  it('un-indexes deleted or DM chat messages instead of chunking them', async () => {
    const deletedDelete = new QueryBuilder();
    const deletedMark = new QueryBuilder();
    const dmDelete = new QueryBuilder();
    const dmMark = new QueryBuilder();
    const { service } = buildService({
      outboxBatches: [
        [
          outboxRow({ id: 1 }),
          outboxRow({
            id: 2,
            source_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          }),
        ],
      ],
      tables: {
        chat_room_messages: [
          chatMessage({ deleted_at: '2026-07-02T00:00:00Z' }),
          chatMessage({ project_id: null }), // DM
        ],
        ai_knowledge_chunks: [deletedDelete, dmDelete],
        ai_knowledge_outbox: [deletedMark, dmMark],
      },
    });

    const result = await service.runIngest();

    expect(result).toMatchObject({ processed: 2, failed: 0 });
    expect(deletedDelete.delete).toHaveBeenCalled();
    expect(dmDelete.delete).toHaveBeenCalled();
  });

  it('delete ops remove chunks without loading the source', async () => {
    const deleteBuilder = new QueryBuilder();
    const markBuilder = new QueryBuilder();
    const { service, db } = buildService({
      outboxBatches: [[outboxRow({ op: 'delete' })]],
      tables: {
        ai_knowledge_chunks: [deleteBuilder],
        ai_knowledge_outbox: [markBuilder],
      },
    });

    await service.runIngest();

    expect(deleteBuilder.delete).toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalledWith('chat_room_messages');
  });

  it('skips projectless task comments (draft roadmaps)', async () => {
    const commentBuilder = new QueryBuilder();
    commentBuilder.__resolveData = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      task_id: 'task-1',
      author_id: 'user-1',
      content: '<p>Looks good</p>',
      created_at: '2026-07-01T00:00:00Z',
      task: {
        id: 'task-1',
        title: 'Build it',
        feature: {
          id: 'f1',
          epic: {
            roadmap_id: 'rm-1',
            roadmap: { id: 'rm-1', project_id: null },
          },
        },
      },
    };
    const deleteBuilder = new QueryBuilder();
    const markBuilder = new QueryBuilder();
    const { service, embeddings } = buildService({
      outboxBatches: [
        [
          outboxRow({
            source_type: 'task_comment',
            source_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          }),
        ],
      ],
      tables: {
        task_comments: [commentBuilder],
        ai_knowledge_chunks: [deleteBuilder],
        ai_knowledge_outbox: [markBuilder],
      },
    });

    const result = await service.runIngest();

    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(embeddings.embedBatch).not.toHaveBeenCalled();
  });

  it('memory rows embed in place and never write chunk rows', async () => {
    const memoryLoad = new QueryBuilder();
    memoryLoad.__resolveData = {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      content: 'Client prefers weekly demos',
      is_active: true,
    };
    const memoryUpdate = new QueryBuilder();
    const markBuilder = new QueryBuilder();
    const { service, db } = buildService({
      outboxBatches: [
        [
          outboxRow({
            source_type: 'memory',
            source_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          }),
        ],
      ],
      tables: {
        roadmap_ai_memories: [memoryLoad, memoryUpdate],
        ai_knowledge_outbox: [markBuilder],
      },
    });

    const result = await service.runIngest();

    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(memoryUpdate.update).toHaveBeenCalledWith({
      embedding: '[0.1,0.2]',
    });
    expect(db.from).not.toHaveBeenCalledWith('ai_knowledge_chunks');
  });

  it('records last_error and keeps the row unprocessed on failure', async () => {
    const failingLoad = new QueryBuilder();
    failingLoad.__resolveError = { message: 'connection reset' };
    const errorBuilder = new QueryBuilder();
    const { service } = buildService({
      outboxBatches: [[outboxRow()]],
      tables: {
        chat_room_messages: [failingLoad],
        ai_knowledge_outbox: [errorBuilder],
      },
    });

    const result = await service.runIngest();

    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(errorBuilder.update).toHaveBeenCalledWith({
      last_error: 'connection reset',
    });
  });
});

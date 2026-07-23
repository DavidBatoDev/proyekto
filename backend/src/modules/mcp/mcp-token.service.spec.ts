import { SupabaseClient } from '@supabase/supabase-js';
import { McpTokenService } from './mcp-token.service';

/**
 * A minimal chainable Supabase stub. Each `.from()` call consumes the next
 * queued `{ data, error }` result; all chain methods return the same builder,
 * which is thenable and also answers `.single()` / `.maybeSingle()`.
 */
function makeDb(queue: Array<{ data: unknown; error: unknown }>) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const db = {
    from(table: string) {
      const result = queue.shift() ?? { data: null, error: null };
      const builder: any = {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          return builder;
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          return builder;
        },
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        order() {
          return Promise.resolve(result);
        },
        single() {
          return Promise.resolve(result);
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onF, onR);
        },
      };
      return builder;
    },
    _calls: calls,
  };
  return db as unknown as SupabaseClient & {
    _calls: typeof calls;
  };
}

describe('McpTokenService', () => {
  it('issues a token, returns the raw value once, and stores only its hash', async () => {
    const db = makeDb([
      {
        data: {
          id: 'tok-1',
          name: 'ci',
          token_prefix: 'pk_abcd1234',
          scopes: ['roadmaps:read'],
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          created_at: '2026-07-23T00:00:00Z',
        },
        error: null,
      },
    ]);
    const svc = new McpTokenService(db);

    const issued = await svc.issueToken('user-1', 'ci', ['roadmaps:read']);

    expect(issued.token.startsWith('pk_')).toBe(true);
    const insert = db._calls.find((c) => c.op === 'insert');
    const payload = insert?.payload as {
      token_hash: string;
      token_prefix: string;
      user_id: string;
    };
    // The raw token is never persisted — only the hash and a display prefix.
    expect(payload.token_hash).not.toContain(issued.token);
    expect(payload.token_hash).toHaveLength(64); // sha256 hex
    expect(issued.token.startsWith(payload.token_prefix)).toBe(true);
    expect(payload.user_id).toBe('user-1');
  });

  it('rejects an unknown scope at issuance', async () => {
    const db = makeDb([]);
    const svc = new McpTokenService(db);
    await expect(
      svc.issueToken('user-1', 'bad', ['roadmaps:write']),
    ).rejects.toThrow(/Unknown MCP scope/);
  });

  it('resolveToken returns null for a revoked token', async () => {
    const db = makeDb([
      {
        data: {
          id: 'tok-1',
          user_id: 'user-1',
          scopes: [],
          expires_at: null,
          revoked_at: '2026-07-01T00:00:00Z',
        },
        error: null,
      },
    ]);
    const svc = new McpTokenService(db);
    expect(await svc.resolveToken('pk_live')).toBeNull();
  });

  it('resolveToken returns null for an expired token', async () => {
    const db = makeDb([
      {
        data: {
          id: 'tok-1',
          user_id: 'user-1',
          scopes: [],
          expires_at: '2000-01-01T00:00:00Z',
          revoked_at: null,
        },
        error: null,
      },
    ]);
    const svc = new McpTokenService(db);
    expect(await svc.resolveToken('pk_live')).toBeNull();
  });

  it('resolveToken returns null for a non-pk_ bearer without hitting the db', async () => {
    const db = makeDb([]);
    const svc = new McpTokenService(db);
    expect(await svc.resolveToken('eyJ-a-jwt')).toBeNull();
    expect(db._calls.length).toBe(0);
  });

  it('resolveToken resolves a live token to its owner + scopes', async () => {
    const db = makeDb([
      {
        data: {
          id: 'tok-1',
          user_id: 'user-9',
          scopes: ['chat:read'],
          expires_at: null,
          revoked_at: null,
        },
        error: null,
      },
      { data: null, error: null }, // last_used_at bump
    ]);
    const svc = new McpTokenService(db);
    const resolved = await svc.resolveToken('pk_live');
    expect(resolved?.user_id).toBe('user-9');
    expect(resolved?.scopes).toEqual(['chat:read']);
  });
});

import { ConfigService } from '@nestjs/config';
import { NotificationEmailWorkerService } from './notification-email-worker.service';

/**
 * A minimal Supabase query-builder double.
 *
 * Every chain in the worker ends in `.maybeSingle()`, `.limit()` or a bare
 * update, so the double records the table + filters and serves whatever the test
 * registered for that table. Faking the client rather than the database keeps
 * this a unit test of the DECISION MATRIX; the trigger and claim RPC are
 * exercised against real Postgres separately.
 */
function makeDb(tables: Record<string, unknown>) {
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  let claimCalls = 0;

  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'in']) {
      chain[method] = jest.fn(self);
    }
    chain.update = jest.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      return chain;
    });
    chain.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: tables[table] ?? null, error: null }),
    );
    return chain;
  };

  const db = {
    from: jest.fn((table: string) => builder(table)),
    rpc: jest.fn(() => {
      claimCalls += 1;
      // First call yields the batch, second ends the loop.
      return Promise.resolve({
        data: claimCalls === 1 ? tables.__claim : [],
        error: null,
      });
    }),
  };

  return { db, updates, lastUpdate: () => updates[updates.length - 1] };
}

const ROW = {
  id: 1,
  notification_id: 'n-1',
  user_id: 'u-1',
  type_name: 'task_comment_mention',
  to_email: null,
  payload: {
    content: { actor_name: 'Ada', excerpt: 'take a look' },
    link_url: '/project/p-1',
  },
};

function build(
  tables: Record<string, unknown>,
  env: Record<string, unknown> = {},
) {
  const { db, updates, lastUpdate } = makeDb(tables);
  const mailer = {
    send: jest.fn().mockResolvedValue({ sent: true, messageId: 'm-1' }),
  };
  const config = new ConfigService({
    APP_URL: 'https://www.proyekto.test',
    PUBLIC_API_URL: 'https://api.proyekto.test/api',
    ...env,
  });
  const service = new NotificationEmailWorkerService(
    db as never,
    mailer as never,
    config,
  );
  return { service, mailer, updates, lastUpdate };
}

/** Defaults that let a row sail through to a send. */
const HAPPY = {
  __claim: [ROW],
  notifications: { id: 'n-1', is_read: false },
  profiles: { email: 'her@example.test', display_name: 'Grace' },
  email_suppressions: null,
  notification_email_settings: {
    all_email_enabled: true,
    unsubscribe_token: 'tok',
  },
  notification_types: { id: 'ty-1', email_default_enabled: true },
  notification_preferences: null,
  notification_email_outbox: null,
};

describe('NotificationEmailWorkerService', () => {
  it('sends an unread notification and marks the row sent', async () => {
    const { service, mailer, updates } = build(HAPPY);

    const result = await service.runDispatch();

    expect(result.sent).toBe(1);
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'her@example.test', sender: 'noreply' }),
    );
    expect(
      updates.some(
        (u) =>
          u.table === 'notification_email_outbox' && u.values.status === 'sent',
      ),
    ).toBe(true);
  });

  it('attaches RFC 8058 one-click unsubscribe headers', async () => {
    const { service, mailer } = build(HAPPY);

    await service.runDispatch();

    const headers = mailer.send.mock.calls[0][0].headers as Record<
      string,
      string
    >;
    // Gmail renders its unsubscribe button only when BOTH are present.
    expect(headers['List-Unsubscribe']).toContain(
      'https://api.proyekto.test/api/notifications/unsubscribe?token=tok',
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it.each([
    [
      'already read',
      { notifications: { id: 'n-1', is_read: true } },
      'already_read',
    ],
    ['the notification is gone', { notifications: null }, 'notification_gone'],
    [
      'the address is suppressed',
      { email_suppressions: { email: 'x' } },
      'suppressed',
    ],
    [
      'the user turned all email off',
      {
        notification_email_settings: {
          all_email_enabled: false,
          unsubscribe_token: 'tok',
        },
      },
      'opted_out_all',
    ],
    [
      'the user turned this type off',
      { notification_preferences: { email_enabled: false } },
      'opted_out_type',
    ],
    [
      'the type default is off and there is no override',
      { notification_types: { id: 'ty-1', email_default_enabled: false } },
      'opted_out_type',
    ],
    ['there is no address', { profiles: { email: null } }, 'no_address'],
  ])('skips when %s', async (_label, overrides, reason) => {
    const { service, mailer, updates } = build({ ...HAPPY, ...overrides });

    const result = await service.runDispatch();

    expect(result.sent).toBe(0);
    expect(result.skippedRows).toBe(1);
    expect(mailer.send).not.toHaveBeenCalled();
    expect(updates.some((u) => u.values.skip_reason === reason)).toBe(true);
  });

  it('skips a DM already read in the room, not just in the bell', async () => {
    // CHAT_SOURCED_TYPES has held chat_dm_received since phase 1 but nothing
    // exercised it. The bell is not marked read when you read a room, so
    // is_read alone would mail someone who already saw the message.
    const sent = new Date(Date.now() - 60_000).toISOString();
    const read = new Date().toISOString();
    const { service, mailer, updates } = build({
      ...HAPPY,
      __claim: [
        {
          ...ROW,
          type_name: 'chat_dm_received',
          payload: {
            content: {
              actor_name: 'Ada',
              room_id: 'room-1',
              message_id: 'msg-1',
            },
            link_url: '/inbox?r=room-1',
          },
        },
      ],
      chat_room_participants: { last_read_at: read },
      chat_room_messages: { created_at: sent },
    });

    await service.runDispatch();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(updates.some((u) => u.values.skip_reason === 'seen_in_app')).toBe(
      true,
    );
  });

  it('sends a DM the recipient has not caught up on', async () => {
    const sent = new Date().toISOString();
    const read = new Date(Date.now() - 60_000).toISOString();
    const { service, mailer } = build({
      ...HAPPY,
      __claim: [
        {
          ...ROW,
          type_name: 'chat_dm_received',
          payload: {
            content: {
              actor_name: 'Ada',
              room_id: 'room-1',
              message_id: 'msg-1',
            },
            link_url: '/inbox?r=room-1',
          },
        },
      ],
      chat_room_participants: { last_read_at: read },
      chat_room_messages: { created_at: sent },
    });

    await service.runDispatch();

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('skips a type this build cannot render, even if the DB says eligible', async () => {
    // The database flag and the registry are independent switches; the answer
    // when they disagree is silence, not a blank email.
    const { service, mailer, updates } = build({
      ...HAPPY,
      __claim: [{ ...ROW, type_name: 'invoice_issued' }],
    });

    await service.runDispatch();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(updates.some((u) => u.values.skip_reason === 'no_template')).toBe(
      true,
    );
  });

  it('defers rather than drops when the user was mailed too recently', async () => {
    const justNow = new Date(Date.now() - 60_000).toISOString();
    const { service, mailer, updates } = build({
      ...HAPPY,
      notification_email_outbox: { processed_at: justNow },
    });

    const result = await service.runDispatch();

    expect(result.deferred).toBe(1);
    expect(result.sent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();

    // Pushed out, still pending — a burst must arrive spread out, never vanish.
    const deferral = updates.find((u) => u.values.send_after);
    expect(deferral).toBeDefined();
    expect(deferral?.values.status).toBeUndefined();
    expect(
      new Date(deferral?.values.send_after as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it('records the error and leaves the row pending when the send fails', async () => {
    const { service, updates } = build(HAPPY);
    (service as unknown as { mailer: { send: jest.Mock } }).mailer.send = jest
      .fn()
      .mockResolvedValue({ sent: false, reason: 'Gmail rejected (429).' });

    const result = await service.runDispatch();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    const failure = updates.find((u) => u.values.last_error);
    expect(failure?.values.last_error).toContain('429');
    // Deliberately NOT marked failed/sent: attempts was burned at claim time, so
    // it retries and dead-letters on its own.
    expect(failure?.values.status).toBeUndefined();
  });
});

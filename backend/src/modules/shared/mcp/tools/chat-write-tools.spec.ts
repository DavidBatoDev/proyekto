import { registerChatWriteTools } from './chat-write.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler by name. */
function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const server = {
    registerTool: (
      name: string,
      _cfg: unknown,
      cb: (a: any) => Promise<any>,
    ) => {
      handlers[name] = cb;
    },
  };
  return { server: server as any, handlers };
}

/** Supabase stub whose chat_messages lookup returns `row`. */
function dbReturning(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row }) }),
      }),
    }),
  };
}

function depsWith(scopes: string[], services: Partial<McpToolDeps['s']> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      chat: {
        sendChannelMessage: jest.fn(async () => ({
          room: { id: 'room-1' },
          message: { id: 'msg-1' },
        })),
        editMessage: jest.fn(async () => ({ message: { id: 'msg-1' } })),
        unsendMessage: jest.fn(async () => ({ ok: true })),
      },
      audit: { log: jest.fn() },
      db: dbReturning({ project_id: 'proj-1', mentions: [] }),
      ...services,
    },
  } as unknown as McpToolDeps;
}

function isError(res: any): boolean {
  return res?.isError === true;
}
function errorCode(res: any): string {
  return JSON.parse(res.content[0].text).error;
}

const ARGS = {
  project_id: 'proj-1',
  room_id: 'room-1',
  content: 'ship it',
};

describe('MCP chat write tools', () => {
  it('denies chat_send_message without chat:write and never calls the service', async () => {
    const sendChannelMessage = jest.fn();
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:read'], {
      chat: { sendChannelMessage } as any,
    });
    registerChatWriteTools(server, deps);

    const res = await handlers.chat_send_message(ARGS);

    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it('sends with an explicit DTO that carries no mentions or attachments', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write']);
    registerChatWriteTools(server, deps);

    await handlers.chat_send_message({ ...ARGS, reply_to_id: 'msg-0' });

    const send = deps.s.chat.sendChannelMessage as jest.Mock;
    expect(send).toHaveBeenCalledTimes(1);
    const [projectId, userId, dto] = send.mock.calls[0];
    expect(projectId).toBe('proj-1');
    // Identity comes from the caller, never from tool arguments.
    expect(userId).toBe('user-1');
    expect(dto).toEqual({
      room_id: 'room-1',
      content: 'ship it',
      reply_to_id: 'msg-0',
    });
    // The security assertion: a future refactor that spreads tool args into the
    // DTO would let a model @-mention everyone or forge an attachment URL.
    expect(dto).not.toHaveProperty('mentions');
    expect(dto).not.toHaveProperty('attachments');
    expect(dto).not.toHaveProperty('slug');
  });

  it('audits the send without copying the message text into the audit row', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write']);
    registerChatWriteTools(server, deps);

    await handlers.chat_send_message(ARGS);

    const log = deps.s.audit.log as jest.Mock;
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0][0];
    expect(entry.action).toBe('mcp.chat_send_message');
    expect(entry.entityType).toBe('chat_message');
    expect(entry.entityId).toBe('msg-1');
    expect(entry.actorId).toBe('user-1');
    // Content lives in chat_messages already; duplicating it here would also
    // push it through the knowledge outbox a second time.
    expect(JSON.stringify(entry.metadata)).not.toContain('ship it');
    expect(entry.metadata.content_length).toBe('ship it'.length);
  });

  it('rejects empty content before reaching the service', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write']);
    registerChatWriteTools(server, deps);

    // zod min(1) rejects at the SDK boundary in production; the handler is
    // called directly here, so assert the service-side guard still holds.
    const res = await handlers.chat_send_message({ ...ARGS, content: '' });
    expect(isError(res)).toBeFalsy();
  });

  it('preserves the stored mention spans when editing', async () => {
    const stored = [{ user_id: 'u9', name: 'Ana', offset: 0, length: 4 }];
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write'], {
      db: dbReturning({ project_id: 'proj-1', mentions: stored }) as any,
    });
    registerChatWriteTools(server, deps);

    await handlers.chat_message_edit({
      message_id: 'msg-1',
      content: 'revised',
    });

    const edit = deps.s.chat.editMessage as jest.Mock;
    const [messageId, userId, dto] = edit.mock.calls[0];
    expect(messageId).toBe('msg-1');
    expect(userId).toBe('user-1');
    // ChatService treats absent mentions as "clear", so passing them back is
    // what stops an edit from wiping chips the user created in the web app.
    expect(dto.mentions).toEqual(stored);
    expect(dto.content).toBe('revised');
  });

  it('skips the audit row for a message with no project (a DM)', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:write'], {
      db: dbReturning({ project_id: null, mentions: [] }) as any,
    });
    registerChatWriteTools(server, deps);

    await handlers.chat_message_unsend({ message_id: 'msg-1' });

    expect(deps.s.chat.unsendMessage).toHaveBeenCalledWith('msg-1', 'user-1');
    expect(deps.s.audit.log).not.toHaveBeenCalled();
  });

  it('denies edit and unsend without chat:write', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['chat:read']);
    registerChatWriteTools(server, deps);

    const edit = await handlers.chat_message_edit({
      message_id: 'msg-1',
      content: 'x',
    });
    const unsend = await handlers.chat_message_unsend({ message_id: 'msg-1' });

    expect(errorCode(edit)).toBe('FORBIDDEN');
    expect(errorCode(unsend)).toBe('FORBIDDEN');
    expect(deps.s.chat.editMessage).not.toHaveBeenCalled();
    expect(deps.s.chat.unsendMessage).not.toHaveBeenCalled();
  });

  it('exposes channel messaging only — no DMs, channel admin, or reactions', async () => {
    const { server, handlers } = captureServer();
    registerChatWriteTools(server, depsWith(['chat:write']));

    // These absences are deliberate Phase-4 decisions, encoded here so adding
    // one later has to be a conscious act rather than a drive-by.
    expect(Object.keys(handlers).sort()).toEqual([
      'chat_message_edit',
      'chat_message_unsend',
      'chat_send_message',
    ]);
  });
});

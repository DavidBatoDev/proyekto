/**
 * Real-DB test for Phase 4b — chat writes and ai-sessions reads — against the
 * live SG project.
 *
 * Both flags are forced on for this process only, so the dark-launch default is
 * unaffected; the gate itself has its own unit spec. Self-cleaning via Harness.
 */
process.env.MCP_ENABLED = 'true';
process.env.MCP_CHAT_WRITE_ENABLED = 'true';

import request from 'supertest';
import { Harness } from './harness';

jest.setTimeout(120000);

const MCP_ACCEPT = 'application/json, text/event-stream';

async function poll<T>(
  fn: () => Promise<T | null>,
  attempts = 25,
  delayMs = 300,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

describe('MCP Phase 4b (chat writes + ai-sessions reads)', () => {
  const h = new Harness();
  let idCounter = 1;

  let owner: Awaited<ReturnType<Harness['createUser']>>;
  let viewer: Awaited<ReturnType<Harness['createUser']>>;
  let outsider: Awaited<ReturnType<Harness['createUser']>>;
  let projectId: string;
  let otherProjectId: string;
  let roadmapId: string;
  let roomId: string;
  let otherRoomId: string;
  let sessionId: string;

  let ownerPat: string;
  let viewerPat: string;
  let outsiderPat: string;

  const call = (
    pat: string,
    name: string,
    args: Record<string, unknown>,
  ): request.Test =>
    request(h.server())
      .post('/mcp')
      .set('Authorization', `Bearer ${pat}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: idCounter++,
        method: 'tools/call',
        params: { name, arguments: args },
      });

  const parse = (res: request.Response) =>
    JSON.parse(res.body.result.content[0].text);
  const isError = (res: request.Response) => res.body.result?.isError === true;
  const errorCode = (res: request.Response) => parse(res).error as string;

  const createChannel = async (
    ownerProjectId: string,
    slug: string,
    members: string[],
  ): Promise<string> => {
    const { data, error } = await h.admin
      .from('chat_rooms')
      .insert({
        project_id: ownerProjectId,
        type: 'channel',
        slug,
        name: slug,
        created_by: owner.id,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`createChannel: ${error?.message}`);
    const id = data.id as string;
    await h.admin
      .from('chat_room_participants')
      .insert(members.map((user_id) => ({ room_id: id, user_id })));
    return id;
  };

  beforeAll(async () => {
    await h.boot();
    owner = await h.createUser('p4-owner');
    viewer = await h.createUser('p4-viewer');
    outsider = await h.createUser('p4-outsider');

    projectId = await h.createProject(owner.id);
    await h.grantAccess(projectId, owner.id, 'owner');
    await h.grantAccess(projectId, viewer.id, 'viewer');
    roadmapId = await h.createRoadmap(owner.id, projectId);

    // A second project the owner has nothing to do with, for the cross-project
    // leak check.
    otherProjectId = await h.createProject(outsider.id);
    await h.grantAccess(otherProjectId, outsider.id, 'owner');

    roomId = await createChannel(projectId, `p4-general-${h.runId}`, [
      owner.id,
      viewer.id,
    ]);
    otherRoomId = await createChannel(otherProjectId, `p4-other-${h.runId}`, [
      outsider.id,
    ]);

    ownerPat = (
      await h.createMcpToken(owner.id, [
        'chat:read',
        'chat:write',
        'ai-sessions:read',
      ])
    ).raw;
    viewerPat = (await h.createMcpToken(viewer.id, ['chat:write'])).raw;
    outsiderPat = (await h.createMcpToken(outsider.id, ['ai-sessions:read']))
      .raw;

    // An AI thread owned by `owner`, carrying internal planner state that must
    // never reach a host model.
    const { data: session, error } = await h.admin
      .from('roadmap_ai_sessions')
      .insert({
        roadmap_id: roadmapId,
        user_id: owner.id,
        title: `p4 thread ${h.runId}`,
        metadata: {
          agent_state: {
            pending_plan: 'SECRET-CANARY',
            change_history: [{ node: 'SNAPSHOT-CANARY' }],
          },
        },
      })
      .select('id')
      .single();
    if (error || !session) throw new Error(`seed session: ${error?.message}`);
    sessionId = session.id as string;

    await h.admin.from('roadmap_ai_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: 'Here is the plan',
      tokens: 812,
      artifacts: [{ secret: 'ARTIFACT-CANARY' }],
      activity_timeline: [{ tool: 'TRACE-CANARY' }],
    });
  });

  afterAll(async () => {
    // Sessions/messages cascade from the roadmap; rooms/participants from the
    // project. Chat messages are removed explicitly rather than relying on
    // cascade ordering.
    await h.admin.from('chat_room_messages').delete().eq('room_id', roomId);
    await h.cleanup();
    await h.close();
  });

  describe('chat writes', () => {
    it('posts a channel message, stores no mentions or attachments, and audits it', async () => {
      const content = `hello from mcp ${h.runId}`;
      const res = await call(ownerPat, 'chat_send_message', {
        project_id: projectId,
        room_id: roomId,
        content,
      }).expect(200);
      expect(isError(res)).toBeFalsy();

      const messageId = parse(res).message.id as string;
      const { data: row } = await h.admin
        .from('chat_room_messages')
        .select('content, mentions, attachments, project_id, sender_id')
        .eq('id', messageId)
        .single();

      expect(row?.content).toBe(content);
      expect(row?.sender_id).toBe(owner.id);
      expect(row?.project_id).toBe(projectId);
      // The tool never forwards these, so a crafted payload cannot ping a
      // project or forge an attachment URL.
      expect(row?.mentions).toEqual([]);
      expect(row?.attachments).toEqual([]);

      const auditRow = await poll(async () => {
        const { data } = await h.admin
          .from('project_activity_log')
          .select('id, metadata')
          .eq('project_id', projectId)
          .eq('action', 'mcp.chat_send_message')
          .eq('entity_id', messageId)
          .limit(1);
        return data && data.length ? data[0] : null;
      });
      expect(auditRow).toBeTruthy();
      // The text lives in chat_room_messages; it must not be duplicated here.
      expect(JSON.stringify(auditRow)).not.toContain(content);
    });

    it('denies a viewer despite a valid chat:write scope', async () => {
      // The whole "scope is necessary but not sufficient" contract in one test:
      // the token is fine, the live Proyekto permission is not.
      const res = await call(viewerPat, 'chat_send_message', {
        project_id: projectId,
        room_id: roomId,
        content: 'viewers cannot post',
      }).expect(200);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
    });

    it('refuses a room belonging to a different project', async () => {
      const res = await call(ownerPat, 'chat_send_message', {
        project_id: projectId,
        room_id: otherRoomId,
        content: 'wrong project',
      }).expect(200);

      expect(isError(res)).toBe(true);
      expect(['NOT_FOUND', 'FORBIDDEN']).toContain(errorCode(res));
    });

    it('preserves mention spans through an edit', async () => {
      const { data: seeded, error } = await h.admin
        .from('chat_room_messages')
        .insert({
          room_id: roomId,
          project_id: projectId,
          sender_id: owner.id,
          content: 'ping @viewer',
          mentions: [
            { user_id: viewer.id, name: 'Viewer', offset: 5, length: 7 },
          ],
        })
        .select('id')
        .single();
      if (error || !seeded) throw new Error(`seed message: ${error?.message}`);

      const res = await call(ownerPat, 'chat_message_edit', {
        message_id: seeded.id as string,
        content: 'ping @viewer (updated)',
      }).expect(200);
      expect(isError(res)).toBeFalsy();

      const { data: after } = await h.admin
        .from('chat_room_messages')
        .select('content, mentions')
        .eq('id', seeded.id as string)
        .single();

      expect(after?.content).toBe('ping @viewer (updated)');
      // ChatService clears mentions when they are absent from the DTO, so this
      // asserts the tool read them back and passed them through.
      expect(after?.mentions).toEqual([
        { user_id: viewer.id, name: 'Viewer', offset: 5, length: 7 },
      ]);
    });

    it('refuses to unsend someone else’s message', async () => {
      const { data: seeded } = await h.admin
        .from('chat_room_messages')
        .insert({
          room_id: roomId,
          project_id: projectId,
          sender_id: viewer.id,
          content: 'not yours',
        })
        .select('id')
        .single();

      const res = await call(ownerPat, 'chat_message_unsend', {
        message_id: seeded!.id as string,
      }).expect(200);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
    });
  });

  describe('ai-sessions reads', () => {
    it('lists the caller’s own threads without leaking agent state', async () => {
      const res = await call(ownerPat, 'roadmap_ai_sessions_list', {
        roadmap_id: roadmapId,
      }).expect(200);
      expect(isError(res)).toBeFalsy();

      // Assert on the RAW response body: a leak nested anywhere still shows up.
      const body = JSON.stringify(res.body);
      for (const canary of [
        'SECRET-CANARY',
        'SNAPSHOT-CANARY',
        'agent_state',
        'pending_plan',
      ]) {
        expect(body).not.toContain(canary);
      }

      const sessions = parse(res).sessions as any[];
      const found = sessions.find((s) => s.id === sessionId);
      expect(found).toBeTruthy();
      expect(found.title).toBe(`p4 thread ${h.runId}`);
      expect(found).not.toHaveProperty('metadata');
      expect(found).not.toHaveProperty('user_id');
    });

    it('reads thread messages without the unvalidated agent jsonb', async () => {
      const res = await call(ownerPat, 'roadmap_ai_session_messages', {
        roadmap_id: roadmapId,
        session_id: sessionId,
      }).expect(200);
      expect(isError(res)).toBeFalsy();

      const body = JSON.stringify(res.body);
      for (const canary of [
        'ARTIFACT-CANARY',
        'TRACE-CANARY',
        'activity_timeline',
        'artifacts',
      ]) {
        expect(body).not.toContain(canary);
      }

      const messages = parse(res).messages as any[];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Here is the plan');
      expect(messages[0]).not.toHaveProperty('tokens');
    });

    it('hides another user’s threads rather than 403-ing', async () => {
      // The outsider owns a different project, so they cannot even see the
      // roadmap: this must be a clean denial, not a leak of thread existence.
      const res = await call(outsiderPat, 'roadmap_ai_sessions_list', {
        roadmap_id: roadmapId,
      }).expect(200);

      if (isError(res)) {
        expect(['NOT_FOUND', 'FORBIDDEN']).toContain(errorCode(res));
      } else {
        expect(parse(res).sessions).toHaveLength(0);
      }
    });

    it('advertises the enabled scopes so the PAT picker need not guess', async () => {
      const res = await request(h.server())
        .get('/api/mcp/tokens/scopes')
        .set('Authorization', `Bearer ${h.mintToken(owner.id, owner.email)}`)
        .expect(200);

      const scopes = res.body.data.scopes as string[];
      // Both Phase 4 scopes are live in this process (flags forced on above).
      expect(scopes).toContain('ai-sessions:read');
      expect(scopes).toContain('chat:write');
      expect(scopes).toContain('roadmaps:read');
    });

    it('denies a token without ai-sessions:read', async () => {
      const res = await call(viewerPat, 'roadmap_ai_sessions_list', {
        roadmap_id: roadmapId,
      }).expect(200);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
    });
  });
});

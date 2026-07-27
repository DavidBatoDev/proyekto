import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Chat writes — CHANNEL MESSAGES ONLY, gated by `chat:write`.
 *
 * ChatService.sendChannelMessage enforces the real capability (`chat.send_messages`,
 * commenter and above, with a consultant/client fallback for people who hold the
 * role without a project_access row), so a scope alone is never enough: a viewer
 * holding a chat:write token still gets FORBIDDEN.
 *
 * Four things are deliberately NOT exposed here:
 *
 *  - DIRECT MESSAGES. sendDmMessage has no capability check at all — the only
 *    gate is "do these two people share any project", and `chat.send_dm` appears
 *    solely as an error string that getPermission is never called on. Exposing
 *    it would let an agent DM anyone across every project the user touches,
 *    including a client on a consulting engagement. Worse, DM messages are
 *    created with project_id null, so they cannot be audited at all. DMs would
 *    need their own scope AND a real service-layer gate first.
 *  - CHANNEL ADMINISTRATION (create/rename/archive, add/remove member). Already
 *    admin-gated, so an agent holding it acts as a project admin, and those
 *    methods already self-audit inside ChatService — bolting auditWrite on top
 *    would double-log.
 *  - REACTIONS. toggleMessageReaction returns {ok:true} with no post-state, so
 *    the model cannot tell an add from a remove and a retry after a transport
 *    timeout silently UNDOES the reaction.
 *  - MENTIONS and ATTACHMENTS, per the notes on each tool below.
 */
export function registerChatWriteTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  /**
   * Resolve a message's owning project (for the audit row) and its stored
   * mention spans (so an edit can preserve them). One lookup, two purposes —
   * mirroring resolveTaskProjectId in task-write.tools.ts.
   *
   * A null project_id means a DM, which this tool set never targets; the audit
   * write is skipped, matching the personal-roadmap skip elsewhere.
   */
  async function resolveMessageContext(messageId: string): Promise<{
    projectId: string | null;
    mentions: unknown[];
  }> {
    const { data } = await deps.s.db
      // NB: the table is `chat_room_messages`, not `chat_messages`. Getting it
      // wrong fails silently — PostgREST returns no rows, so mentions would come
      // back empty and the edit would wipe them, which is the exact bug this
      // lookup exists to prevent.
      .from('chat_room_messages')
      .select('project_id, mentions')
      .eq('id', messageId)
      .maybeSingle();
    return {
      projectId: (data?.project_id as string | null) ?? null,
      mentions: (data?.mentions as unknown[] | null) ?? [],
    };
  }

  function auditWrite(
    projectId: string | null,
    action: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ): void {
    if (!projectId) return;
    // Fire-and-forget (AuditService.log never throws / never awaits).
    // NOTE: never put message content in here. The chat_messages row already
    // holds it, and AuditService.log feeds the knowledge outbox — duplicating
    // would embed the same text twice.
    deps.s.audit.log({
      projectId,
      actorId: uid,
      action,
      entityType: 'chat_message',
      entityId,
      metadata: { scopes: deps.caller.scopes, ...metadata },
    });
  }

  defineTool(
    server,
    'chat_send_message',
    {
      title: 'Send a chat message',
      description:
        'Post a message to a project chat channel. Everyone in the channel sees it immediately and it cannot be recalled, so confirm the exact text and the target room with the user first. Get room_id from chat_rooms_list — never guess it. You cannot attach files or @-mention people through this server.',
      inputSchema: {
        project_id: z.string().uuid(),
        // Required on purpose. ChatService's no-room_id path calls
        // provisionDefaultChannels — it CREATES rooms as a side effect of a
        // send, and falls back to #general when a slug misses. Requiring the id
        // forces a chat_rooms_list first and removes both surprises.
        room_id: z.string().uuid(),
        // Required at the schema layer: the service permits content-less
        // messages when attachments exist, and we never send attachments, so
        // this turns a service 400 into a clean pre-flight VALIDATION_FAILED.
        content: z.string().min(1).max(4000),
        reply_to_id: z.string().uuid().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ project_id, room_id, content, reply_to_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:write');
        // Built as an explicit literal, never a spread of the tool args: this
        // is what guarantees `mentions` and `attachments` cannot reach the
        // service even if the input schema later grows.
        const result = await deps.s.chat.sendChannelMessage(project_id, uid, {
          room_id,
          content,
          reply_to_id,
        });
        const message = (result as { message: { id: string } }).message;
        auditWrite(project_id, 'mcp.chat_send_message', message.id, {
          room_id,
          content_length: content.length,
        });
        return result;
      }),
  );

  defineTool(
    server,
    'chat_message_edit',
    {
      title: 'Edit a chat message',
      description:
        'Edit the text of a message you sent. Shows an "(edited)" marker to everyone in the channel. You can only edit your own messages.',
      inputSchema: {
        message_id: z.string().uuid(),
        content: z.string().min(1).max(4000),
      },
      annotations: { destructiveHint: true },
    },
    async ({ message_id, content }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:write');
        // ChatService.editMessage treats an absent `mentions` as "clear them"
        // rather than "leave unchanged" — buildMentions(undefined) returns []
        // and that empty array is written straight over the stored spans. So an
        // edit that did not read them first would silently destroy the mention
        // chips on a message the user originally posted from the web app.
        const { projectId, mentions } = await resolveMessageContext(message_id);
        const result = await deps.s.chat.editMessage(message_id, uid, {
          content,
          mentions: mentions as never,
        });
        auditWrite(projectId, 'mcp.chat_message_edit', message_id, {
          content_length: content.length,
        });
        return result;
      }),
  );

  defineTool(
    server,
    'chat_message_unsend',
    {
      title: 'Unsend a chat message',
      description:
        'Delete a message you sent. This is the corrective action if you posted something wrong. You can only unsend your own messages.',
      inputSchema: { message_id: z.string().uuid() },
      annotations: { destructiveHint: true },
    },
    async ({ message_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:write');
        const { projectId } = await resolveMessageContext(message_id);
        const result = await deps.s.chat.unsendMessage(message_id, uid);
        auditWrite(projectId, 'mcp.chat_message_unsend', message_id);
        return result;
      }),
  );
}

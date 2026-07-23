import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Chat read tools. Gated by `chat:read`; the ChatService methods enforce
 * project membership + per-room participation, so a caller only ever sees rooms
 * and messages they belong to.
 */
export function registerChatTools(server: McpServer, deps: McpToolDeps) {
  const uid = deps.caller.userId;

  defineTool(
    server,
    'chat_rooms_list',
    {
      title: 'List chat rooms',
      description:
        'List the chat channels in a project that the authenticated user participates in.',
      inputSchema: { project_id: z.string().uuid() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:read');
        const rooms = await deps.s.chat.listRooms(project_id, uid);
        return { rooms };
      }),
  );

  defineTool(
    server,
    'chat_messages_list',
    {
      title: 'List chat messages',
      description:
        'List recent messages in a chat room the user participates in, newest first. Use `before` (an ISO timestamp) to page backwards.',
      inputSchema: {
        room_id: z.string().uuid(),
        before: z.string().optional(),
        limit: z.number().int().min(1).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ room_id, before, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:read');
        const messages = await deps.s.chat.listRoomMessages(
          room_id,
          uid,
          before,
          clampLimit(limit, deps.s.maxPageSize, 30),
        );
        return { messages };
      }),
  );

  defineTool(
    server,
    'chat_messages_search',
    {
      title: 'Search chat messages',
      description:
        'Search the messages of a chat room the user participates in by keyword.',
      inputSchema: {
        room_id: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().int().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ room_id, query, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:read');
        return deps.s.chat.searchRoomMessages(
          room_id,
          uid,
          query,
          clampLimit(limit, deps.s.maxPageSize, 30),
        );
      }),
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  clampLimit,
  clampOffset,
  defineTool,
  fetchWindow,
  pageFetchedList,
  pageFromStart,
  pagingClause,
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
        'List the chat channels in a project that the authenticated user participates in.' +
        pagingClause(50, 50),
      inputSchema: {
        project_id: z.string().uuid(),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      project_id,
      limit,
      offset,
    }: {
      project_id: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:read');
        const rooms = await deps.s.chat.listRooms(project_id, uid);
        return pageFromStart(rooms, 'rooms', {
          offset: clampOffset(offset),
          limit: clampLimit(limit, deps.s.maxPageSize, 50),
          complete: true,
        });
      }),
  );

  defineTool(
    server,
    'chat_messages_list',
    {
      title: 'List chat messages',
      description:
        'List recent messages in a chat room the user participates in, newest first. Use `before` (an ISO timestamp) to page backwards — pass the returned `next_before` to continue.',
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
        const size = clampLimit(limit, deps.s.maxPageSize, 30);
        // The service already answers {room_id, messages, next_before}; the
        // tool used to wrap that whole object as `messages`, hiding the cursor
        // one level down. Flatten it so the keyset page is what it looks like.
        const page = await deps.s.chat.listRoomMessages(
          room_id,
          uid,
          before,
          size,
        );
        return {
          room_id: page.room_id,
          messages: page.messages,
          returned_messages: page.messages.length,
          next_before: page.next_before,
        };
      }),
  );

  defineTool(
    server,
    'chat_messages_search',
    {
      title: 'Search chat messages',
      description:
        'Search the messages of a chat room the user participates in by keyword.' +
        pagingClause(50, 30),
      inputSchema: {
        room_id: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      room_id,
      query,
      limit,
      offset,
    }: {
      room_id: string;
      query: string;
      limit?: number;
      offset?: number;
    }) =>
      runTool(async () => {
        requireScope(deps.caller, 'chat:read');
        const size = clampLimit(limit, deps.s.maxPageSize, 30);
        const start = clampOffset(offset);
        // The service ranks from the start and caps at 50.
        const window = fetchWindow(start, size, 50);
        const result = (await deps.s.chat.searchRoomMessages(
          room_id,
          uid,
          query,
          window,
        )) as unknown as Record<string, unknown>;
        return pageFetchedList(result, 'results', {
          offset: start,
          limit: size,
          window,
        });
      }),
  );
}

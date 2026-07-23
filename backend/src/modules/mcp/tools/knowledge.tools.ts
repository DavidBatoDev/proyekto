import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KNOWLEDGE_SEARCH_SOURCE_TYPES } from '../../roadmaps/dto/roadmap-ai-knowledge.dto';
import {
  clampLimit,
  defineTool,
  requireScope,
  runTool,
  type McpToolDeps,
} from './tool-helpers';

/**
 * Hybrid RAG search over the authorized project knowledge (chat, comments,
 * activity, briefs) for the roadmap's project. Gated by `knowledge:read`; the
 * underlying service enforces read-level roadmap access + per-room chat ACLs
 * and returns empty results for project-less/guest roadmaps.
 */
export function registerKnowledgeTools(server: McpServer, deps: McpToolDeps) {
  defineTool(
    server,
    'project_knowledge_search',
    {
      title: 'Search project knowledge',
      description:
        'Semantic + keyword search across the project knowledge behind a roadmap: chat messages, task comments, activity log, and the brief. Only content you are authorized to see is searched.',
      inputSchema: {
        roadmap_id: z.string().uuid(),
        query: z.string().min(1).max(500),
        sources: z.array(z.enum(KNOWLEDGE_SEARCH_SOURCE_TYPES)).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ roadmap_id, query, sources, limit }) =>
      runTool(async () => {
        requireScope(deps.caller, 'knowledge:read');
        return deps.s.knowledge.searchKnowledge(
          roadmap_id,
          { id: deps.caller.userId },
          { query, sources, limit: clampLimit(limit, 20, 10) },
        );
      }),
  );
}

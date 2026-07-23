import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { McpAuthGuard, McpAuthenticatedRequest } from './mcp-auth.guard';
import { McpServerFactory } from './mcp-server.factory';

/**
 * The Model Context Protocol endpoint, served at `/mcp` (outside the global
 * `/api` prefix). Stateless Streamable-HTTP: each POST spins up a fresh server +
 * transport bound to the caller resolved by McpAuthGuard, handles the single
 * JSON-RPC request, and tears both down when the response closes. No session is
 * held server-side, which fits Cloud Run's per-request lifecycle.
 */
@Controller('mcp')
@UseGuards(McpAuthGuard)
export class McpController {
  constructor(private readonly factory: McpServerFactory) {}

  @Post()
  @RawResponse()
  async handle(
    @Req() req: McpAuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const server = this.factory.create({
      userId: req.user.id,
      scopes: req.mcpScopes ?? [],
    });
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no server-held session, and each POST returns a single JSON
      // response rather than opening an SSE stream — fits Cloud Run's
      // per-request lifecycle and the compression bypass.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req as unknown as Request, res, req.body);
  }

  // Stateless mode does not support the GET (server-initiated SSE) or session
  // channels; respond with 405 so hosts fall back to plain POST.
  @Get()
  @RawResponse()
  notAllowed(@Res() res: Response): void {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  }
}

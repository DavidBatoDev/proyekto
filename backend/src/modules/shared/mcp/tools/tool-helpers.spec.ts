import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildPlanLimitPayload } from '../../entitlements/__entitlements-test-kit-spec';
import { PlanLimitException } from '../../entitlements/plan-limit.exception';
import { MissingPermissionException } from '../../../execution/projects/authorization/missing-permission.exception';
import {
  McpToolError,
  assertProjectViewer,
  clampLimit,
  normalizeError,
  requireScope,
  runTool,
  toErrorResult,
  type McpToolDeps,
} from './tool-helpers';

describe('MCP tool helpers', () => {
  describe('requireScope', () => {
    it('passes when the scope is granted', () => {
      expect(() =>
        requireScope(
          { userId: 'u', scopes: ['roadmaps:read'] },
          'roadmaps:read',
        ),
      ).not.toThrow();
    });

    it('throws FORBIDDEN when the scope is missing', () => {
      try {
        requireScope({ userId: 'u', scopes: [] }, 'roadmaps:read');
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(McpToolError);
        expect((err as McpToolError).code).toBe('FORBIDDEN');
      }
    });
  });

  describe('clampLimit', () => {
    it('clamps to the max and floors', () => {
      expect(clampLimit(9999, 100)).toBe(100);
      expect(clampLimit(10.9, 100)).toBe(10);
    });
    it('falls back for invalid input', () => {
      expect(clampLimit(undefined, 100, 25)).toBe(25);
      expect(clampLimit(-5, 100, 25)).toBe(25);
    });
  });

  describe('assertProjectViewer', () => {
    const depsWith = (perms: unknown): McpToolDeps =>
      ({
        caller: { userId: 'u', scopes: [] },
        s: {
          projectAuthz: {
            resolvePermissions: jest.fn().mockResolvedValue(perms),
          },
        },
      }) as unknown as McpToolDeps;

    it('returns permissions when the caller has access', async () => {
      const perms = { roadmap: { view: true } };
      await expect(assertProjectViewer(depsWith(perms), 'p1')).resolves.toBe(
        perms,
      );
    });

    it('throws NOT_FOUND (no existence leak) when the caller has no access', async () => {
      await expect(assertProjectViewer(depsWith(null), 'p1')).rejects.toEqual(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });

  describe('runTool error mapping', () => {
    it('maps a ForbiddenException to a FORBIDDEN error result', async () => {
      const res = (await runTool(() => {
        throw new ForbiddenException('nope');
      })) as { isError?: boolean; content: { text: string }[] };
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).error).toBe('FORBIDDEN');
    });

    it('maps a NotFoundException to a NOT_FOUND error result', async () => {
      const res = (await runTool(() => {
        throw new NotFoundException('missing');
      })) as { isError?: boolean; content: { text: string }[] };
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).error).toBe('NOT_FOUND');
    });

    it('returns content (no isError) on success', async () => {
      const res = (await runTool(() => ({ ok: 1 }))) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(res.isError).toBeUndefined();
      expect(JSON.parse(res.content[0].text)).toEqual({ ok: 1 });
    });

    it('returns JSON, SVG, and PNG blocks for a visual result', async () => {
      const res = (await runTool(() => ({ ok: 1 }), {
        enabled: true,
        create: () => ({
          svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
          pngBase64: 'iVBORw0KGgo=',
          uri: 'proyekto://roadmaps/r1/visual.svg',
          alt: 'Roadmap',
        }),
      })) as any;

      expect(res.content.map((item: any) => item.type)).toEqual([
        'text',
        'resource',
        'image',
      ]);
      expect(res.content[1].resource.mimeType).toBe('image/svg+xml');
      expect(res.content[2].mimeType).toBe('image/png');
      expect(res.structuredContent.visual.svg_uri).toBe(
        'proyekto://roadmaps/r1/visual.svg',
      );
    });

    it('keeps successful data and warns when visual rendering fails', async () => {
      const res = (await runTool(() => ({ ok: 1 }), {
        enabled: true,
        create: () => {
          throw new Error('render failed');
        },
      })) as any;

      expect(res.isError).toBeUndefined();
      expect(JSON.parse(res.content[0].text)).toEqual({ ok: 1 });
      expect(JSON.parse(res.content[1].text).visual_warning.code).toBe(
        'VISUAL_RENDER_FAILED',
      );
      expect(res.structuredContent.visual_warning.code).toBe(
        'VISUAL_RENDER_FAILED',
      );
    });

    it('maps a PlanLimitException (403 plan_limit) to PLAN_LIMIT, keeping its message', async () => {
      const payload = buildPlanLimitPayload({
        kind: 'feature',
        limit_key: 'change_requests',
        message: 'Change requests are available on Pro and above.',
      });
      const res = (await runTool(() => {
        throw new PlanLimitException(payload);
      })) as { isError?: boolean; content: { text: string }[] };

      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text)).toEqual({
        error: 'PLAN_LIMIT',
        message: 'Change requests are available on Pro and above.',
      });
    });

    it('keeps a missing_permission 403 as FORBIDDEN', async () => {
      const res = (await runTool(() => {
        throw new MissingPermissionException({ path: 'risks.edit' });
      })) as { isError?: boolean; content: { text: string }[] };
      expect(JSON.parse(res.content[0].text).error).toBe('FORBIDDEN');
    });

    it('does not create a visual when it is disabled', async () => {
      const create = jest.fn();
      const res = (await runTool(() => ({ ok: 1 }), {
        enabled: false,
        create,
      })) as any;

      expect(create).not.toHaveBeenCalled();
      expect(res.content).toHaveLength(1);
      expect(res.content[0].type).toBe('text');
      expect(res.structuredContent).toEqual({ ok: 1 });
    });
  });

  describe('normalizeError / toErrorResult', () => {
    it('recognises plan_limit by the response code, not the class', () => {
      // Any 403 whose body says plan_limit, e.g. one rethrown across a module.
      const err = new ForbiddenException({
        code: 'plan_limit',
        message: 'MCP server is available on Pro and above.',
      });
      expect(normalizeError(err)).toEqual({
        code: 'PLAN_LIMIT',
        message: 'MCP server is available on Pro and above.',
      });
    });

    it('passes an McpToolError PLAN_LIMIT through unchanged', () => {
      expect(
        normalizeError(new McpToolError('PLAN_LIMIT', 'Not on Free.')),
      ).toEqual({ code: 'PLAN_LIMIT', message: 'Not on Free.' });
    });

    it('builds the same error result runTool returns', async () => {
      const err = new NotFoundException('missing');
      expect(toErrorResult(err)).toEqual(
        await runTool(() => {
          throw err;
        }),
      );
    });
  });
});

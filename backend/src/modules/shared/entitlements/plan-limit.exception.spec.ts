import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from '../../../common/filters/http-exception.filter';
import { buildPlanLimitPayload } from './__entitlements-test-kit-spec';
import {
  isPlanLimitException,
  PlanLimitException,
} from './plan-limit.exception';

function runFilter(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/projects' }),
    }),
  } as any;
  new HttpExceptionFilter().catch(exception, host);
  return {
    status: (status.mock.calls[0] as unknown[])[0],
    body: (json.mock.calls[0] as unknown[])[0] as {
      error: Record<string, unknown>;
    },
  };
}

describe('PlanLimitException', () => {
  const payload = buildPlanLimitPayload();

  it('is a 403 ForbiddenException carrying the payload as its response body', () => {
    const exception = new PlanLimitException(payload);

    expect(exception).toBeInstanceOf(ForbiddenException);
    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).toEqual(payload);
    expect(exception.payload).toBe(payload);
    expect(exception.message).toBe(payload.message);
    expect(isPlanLimitException(exception)).toBe(true);
    expect(isPlanLimitException(new ForbiddenException())).toBe(false);
  });

  it('reaches the client as error.code = plan_limit with every field', () => {
    const { status, body } = runFilter(new PlanLimitException(payload));

    expect(status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'plan_limit',
      kind: 'count',
      limit_key: 'projects',
      label: 'Projects',
      limit: 2,
      used: 2,
      plan: 'free',
      upgrade_plan: 'pro',
      workspace_id: 'ws-1',
      workspace_slug: 'acme',
      context: 'create',
      message: payload.message,
      status: 403,
      path: '/api/projects',
    });
    expect(typeof body.error.timestamp).toBe('string');
    expect(body.error).not.toHaveProperty('statusCode');
  });

  it('keeps a null upgrade_plan and feature nulls on the wire', () => {
    const { body } = runFilter(
      new PlanLimitException(
        buildPlanLimitPayload({
          kind: 'feature',
          limit_key: 'saml_scim',
          label: 'SAML and SCIM',
          limit: null,
          used: null,
          plan: 'enterprise',
          upgrade_plan: null,
          message: 'SAML and SCIM are not included in the Enterprise plan.',
        }),
      ),
    );
    expect(body.error).toMatchObject({
      code: 'plan_limit',
      kind: 'feature',
      limit: null,
      used: null,
      upgrade_plan: null,
    });
  });
});

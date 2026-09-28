import 'reflect-metadata';
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { UpdateWorkspaceDto } from '../../../execution/workspaces/dto/workspaces.dto';
import {
  AdminWorkspacesQueryDto,
  ClearWorkspaceCompDto,
  SetWorkspaceCompDto,
  UpdatePlanLimitsDto,
} from './entitlements.dto';

/** The global pipe exactly as main.ts configures it. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

function body(metatype: ArgumentMetadata['metatype']): ArgumentMetadata {
  return { type: 'body', metatype };
}

function query(metatype: ArgumentMetadata['metatype']): ArgumentMetadata {
  return { type: 'query', metatype };
}

async function accepts(
  value: unknown,
  metadata: ArgumentMetadata,
): Promise<unknown> {
  return pipe.transform(value, metadata);
}

async function rejects(value: unknown, metadata: ArgumentMetadata) {
  await expect(pipe.transform(value, metadata)).rejects.toMatchObject({
    status: 400,
  });
}

describe('UpdatePlanLimitsDto', () => {
  const meta = body(UpdatePlanLimitsDto);

  it('accepts numeric, unlimited and feature changes with a PostgREST version', async () => {
    const dto = (await accepts(
      {
        changes: [
          { plan: 'free', key: 'projects', value: 3 },
          { plan: 'pro', key: 'teams', value: null },
          { plan: 'free', key: 'decisions', enabled: true },
          {
            plan: 'pro',
            key: 'ai_messages_monthly',
            per_seat: true,
            display_label: 'Fair use',
          },
        ],
        note: 'Launch promo',
        base_version: '2026-09-22T12:00:00.123456+00:00',
      },
      meta,
    )) as UpdatePlanLimitsDto;

    // null survives implicit conversion: it means unlimited, not 0.
    expect(dto.changes[1].value).toBeNull();
    expect(dto.changes[0].value).toBe(3);
  });

  it.each([
    ['no changes', { changes: [] }],
    [
      'more than 200 changes',
      {
        changes: Array.from({ length: 201 }, () => ({
          plan: 'free',
          key: 'projects',
          value: 1,
        })),
      },
    ],
    [
      'an unknown plan',
      { changes: [{ plan: 'gold', key: 'projects', value: 1 }] },
    ],
    [
      'a malformed key',
      { changes: [{ plan: 'free', key: 'Projects!', value: 1 }] },
    ],
    [
      'a negative value',
      { changes: [{ plan: 'free', key: 'projects', value: -1 }] },
    ],
    [
      'a fractional value',
      { changes: [{ plan: 'free', key: 'projects', value: 1.5 }] },
    ],
    [
      'a value over a billion',
      { changes: [{ plan: 'free', key: 'projects', value: 1_000_000_001 }] },
    ],
    [
      'a label over 40 characters',
      {
        changes: [
          { plan: 'free', key: 'projects', display_label: 'x'.repeat(41) },
        ],
      },
    ],
    [
      'an undeclared field',
      { changes: [{ plan: 'free', key: 'projects', value: 1, kind: 'count' }] },
    ],
    [
      'a note over 1000 characters',
      {
        changes: [{ plan: 'free', key: 'projects', value: 1 }],
        note: 'x'.repeat(1001),
      },
    ],
    [
      'a version that is not a timestamp',
      {
        changes: [{ plan: 'free', key: 'projects', value: 1 }],
        base_version: 'yesterday',
      },
    ],
  ])('rejects %s', async (_label, value) => {
    await rejects(value, meta);
  });
});

describe('AdminWorkspacesQueryDto', () => {
  const meta = query(AdminWorkspacesQueryDto);

  it('converts page numbers from the query string', async () => {
    const dto = (await accepts(
      { search: 'acme', filter: 'comped', page: '2', page_size: '50' },
      meta,
    )) as AdminWorkspacesQueryDto;

    expect(dto).toMatchObject({ page: 2, page_size: 50, filter: 'comped' });
  });

  it.each([
    ['an unknown filter', { filter: 'over_limit' }],
    ['page 0', { page: '0' }],
    ['a page size over 100', { page_size: '101' }],
    ['a search over 100 characters', { search: 'x'.repeat(101) }],
    ['an undeclared parameter', { q: 'acme' }],
  ])('rejects %s', async (_label, value) => {
    await rejects(value, meta);
  });
});

describe('SetWorkspaceCompDto', () => {
  const meta = body(SetWorkspaceCompDto);

  it('accepts a comp with or without an end date', async () => {
    await accepts({ plan: 'business', note: 'Design partner' }, meta);
    await accepts(
      { plan: 'pro', until: '2027-01-01T00:00:00Z', note: 'Trial' },
      meta,
    );
    await accepts({ plan: 'enterprise', until: null, note: 'Partner' }, meta);
  });

  it.each([
    ['a free comp', { plan: 'free', note: 'x' }],
    ['no note', { plan: 'pro' }],
    ['a blank note', { plan: 'pro', note: '   ' }],
    ['a note over 1000 characters', { plan: 'pro', note: 'x'.repeat(1001) }],
    ['an end that is not a date', { plan: 'pro', note: 'x', until: 'soon' }],
  ])('rejects %s', async (_label, value) => {
    await rejects(value, meta);
  });
});

describe('ClearWorkspaceCompDto', () => {
  it('accepts no body at all, or a note', async () => {
    await accepts(undefined, body(ClearWorkspaceCompDto));
    await accepts({ note: 'Ended' }, body(ClearWorkspaceCompDto));
    await accepts({ note: 'Ended' }, query(ClearWorkspaceCompDto));
  });

  it('rejects a note over 1000 characters', async () => {
    await rejects({ note: 'x'.repeat(1001) }, body(ClearWorkspaceCompDto));
  });
});

describe('UpdateWorkspaceDto', () => {
  it('rejects the complimentary-plan columns: members cannot comp themselves', async () => {
    await rejects(
      { name: 'Acme', is_discounted_free: true, discounted_plan: 'enterprise' },
      body(UpdateWorkspaceDto),
    );
  });
});

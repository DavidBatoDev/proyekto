import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailerService } from '../../../../common/mail/mailer.service';
import type { FinanceBookAccessService } from './finance-book-access.service';
import { FinanceInvitesService } from './finance-invites.service';

/** Chainable stub — same pattern as finance-book-access.service.spec.ts. */
function stubSupabase(
  results: Record<
    string,
    Array<{ data?: unknown; count?: number | null; error?: unknown }>
  >,
): SupabaseClient {
  const queues = new Map(Object.entries(results).map(([k, v]) => [k, [...v]]));
  return {
    from(table: string) {
      const next = queues.get(table)?.shift() ?? { data: null, count: 0 };
      const outcome = {
        data: next.data ?? null,
        count: next.count ?? null,
        error: next.error ?? null,
      };
      const builder: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve(outcome),
        single: () => Promise.resolve(outcome),
        then: (
          resolve: (value: typeof outcome) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(outcome).then(resolve, reject),
      };
      for (const method of [
        'select',
        'eq',
        'in',
        'not',
        'order',
        'insert',
        'update',
        'delete',
      ]) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const accessStub = {
  assertBookCapability: jest.fn(),
} as unknown as FinanceBookAccessService;
const mailerStub = {
  send: jest.fn().mockResolvedValue({ sent: true }),
} as unknown as MailerService;
const configStub = {
  get: () => undefined,
} as unknown as ConfigService;

function makeService(supabase: SupabaseClient): FinanceInvitesService {
  return new FinanceInvitesService(
    supabase,
    accessStub,
    mailerStub,
    configStub,
  );
}

const futureIso = new Date(Date.now() + 86_400_000).toISOString();
const pendingInvite = {
  id: 'inv1',
  book_id: 'f2',
  email: 'hr@example.com',
  finance_role: 'accountant',
  capabilities: {},
  token: 'tok',
  status: 'pending',
  invited_by: 'u-owner',
  accepted_by: null,
  expires_at: futureIso,
  accepted_at: null,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T00:00:00Z',
};

describe('FinanceInvitesService accept flow', () => {
  it('accepts a pending invite: member row + status flip', async () => {
    const service = makeService(
      stubSupabase({
        finance_invites: [
          { data: pendingInvite }, // fetchByToken
          { data: { ...pendingInvite, status: 'accepted' } }, // update
        ],
        finance_book_members: [{ data: null }], // insert
      }),
    );
    const result = await service.accept('u-hr', 'tok');
    expect(result).toEqual({ book_id: 'f2', finance_role: 'accountant' });
  });

  it('tolerates an existing membership (unique-index 23505) on accept', async () => {
    const service = makeService(
      stubSupabase({
        finance_invites: [
          { data: pendingInvite },
          { data: { ...pendingInvite, status: 'accepted' } },
        ],
        finance_book_members: [
          { error: { code: '23505', message: 'duplicate key' } },
        ],
      }),
    );
    await expect(service.accept('u-hr', 'tok')).resolves.toEqual({
      book_id: 'f2',
      finance_role: 'accountant',
    });
  });

  it('refuses a settled invite', async () => {
    const service = makeService(
      stubSupabase({
        finance_invites: [{ data: { ...pendingInvite, status: 'cancelled' } }],
      }),
    );
    await expect(service.accept('u-hr', 'tok')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lazily expires a pending invite past its expiry', async () => {
    const service = makeService(
      stubSupabase({
        finance_invites: [
          {
            data: {
              ...pendingInvite,
              expires_at: '2020-01-01T00:00:00Z',
            },
          },
          { data: null }, // lazy expiry update
        ],
      }),
    );
    await expect(service.accept('u-hr', 'tok')).rejects.toThrow(
      'Invite is already expired',
    );
  });

  it('unknown token reads as NotFound', async () => {
    const service = makeService(stubSupabase({ finance_invites: [] }));
    await expect(service.accept('u-hr', 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

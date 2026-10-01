import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { MailerService } from '../../../common/mail/mailer.service';
import { EmailOtpService } from './email-otp.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'gt',
    'order',
    'limit',
    'update',
    'insert',
  ]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve);
  return chain;
}

function resetRow(userId: string, code = '123456') {
  const salt = 'salt';
  return {
    id: 'reset-1',
    user_id: userId,
    salt,
    code_hash: createHash('sha256').update(`${salt}|${code}`).digest('hex'),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function setup(opts: {
  lookup: { data: string | null; error: { message: string } | null };
  row?: ReturnType<typeof resetRow> | null;
}) {
  const rpc = jest.fn().mockResolvedValue(opts.lookup);
  const updateUserById = jest.fn().mockResolvedValue({ error: null });
  const from = jest.fn(() => query({ data: opts.row ?? null, error: null }));
  const supabase = {
    rpc,
    from,
    auth: { admin: { updateUserById } },
  } as unknown as SupabaseClient;
  const service = new EmailOtpService(supabase, new ConfigService({}), {
    send: jest.fn(),
  } as unknown as MailerService);
  return { service, rpc, updateUserById, from };
}

describe('EmailOtpService email lookup', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  afterEach(() => fetchSpy.mockClear());
  afterAll(() => fetchSpy.mockRestore());

  it('resolves through the exact-match RPC with a normalised address', async () => {
    const { service, rpc } = setup({ lookup: { data: OWNER, error: null } });

    await expect(
      service.resolveUserIdByEmail('  Owner@Example.com '),
    ).resolves.toBe(OWNER);
    expect(rpc).toHaveBeenCalledWith('auth_user_id_by_email', {
      p_email: 'owner@example.com',
    });
    // The old fallback (GoTrue admin list, which ignores ?email=) is gone.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for an unknown address, never someone else', async () => {
    const { service } = setup({ lookup: { data: null, error: null } });
    await expect(
      service.resolveUserIdByEmail('nobody@example.com'),
    ).resolves.toBeNull();
    await expect(service.isEmailRegistered('nobody@example.com')).resolves.toBe(
      false,
    );
  });

  it('fails closed when the lookup errors', async () => {
    const { service } = setup({
      lookup: { data: null, error: { message: 'boom' } },
    });
    await expect(
      service.resolveUserIdByEmail('owner@example.com'),
    ).resolves.toBeNull();
  });
});

describe('EmailOtpService.confirmPasswordReset', () => {
  const dto = {
    email: 'owner@example.com',
    code: '123456',
    newPassword: 'a-new-password',
  };

  it("resets the owner's password when the row belongs to them", async () => {
    const { service, updateUserById } = setup({
      lookup: { data: OWNER, error: null },
      row: resetRow(OWNER),
    });

    await expect(service.confirmPasswordReset(dto)).resolves.toMatchObject({
      success: true,
    });
    expect(updateUserById).toHaveBeenCalledWith(OWNER, {
      password: dto.newPassword,
    });
  });

  it('refuses a row bound to a different account (the takeover case)', async () => {
    const { service, updateUserById } = setup({
      lookup: { data: OWNER, error: null },
      row: resetRow(SOMEONE_ELSE),
    });

    await expect(service.confirmPasswordReset(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('refuses when the address no longer has an account', async () => {
    const { service, updateUserById } = setup({
      lookup: { data: null, error: null },
      row: resetRow(SOMEONE_ELSE),
    });

    await expect(service.confirmPasswordReset(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

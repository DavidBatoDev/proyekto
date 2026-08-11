import { ConflictException } from '@nestjs/common';
import { SupabaseAdminRepository } from './admin.repository.supabase';

describe('SupabaseAdminRepository consultant enrollment lifecycle', () => {
  it('upserts verification before approving and records the reviewing admin', async () => {
    const applicationBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValueOnce({ data: { user_id: 'consultant-1' } })
        .mockResolvedValueOnce({
          data: { id: 'application-1', user_id: 'consultant-1' },
          error: null,
        }),
    };
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: jest.fn((table: string) =>
        table === 'consultant_profiles' ? { upsert } : applicationBuilder,
      ),
    };
    const repo = new SupabaseAdminRepository(supabase as never);

    await repo.approveApplication('application-1', 'admin-1');

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'consultant-1',
        status: 'verified',
        application_id: 'application-1',
        suspended_at: null,
        revoked_at: null,
        status_reason: null,
        status_changed_by: 'admin-1',
      }),
      { onConflict: 'user_id' },
    );
    expect(applicationBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        reviewed_by: 'admin-1',
        rejection_reason: null,
      }),
    );
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(
      applicationBuilder.update.mock.invocationCallOrder[0],
    );
  });

  it('writes reviewed_by and the reason on rejection', async () => {
    const builder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: 'application-1', user_id: 'consultant-1' },
        error: null,
      }),
    };
    const repo = new SupabaseAdminRepository({ from: () => builder } as never);

    await repo.rejectApplication(
      'application-1',
      'admin-1',
      'Insufficient evidence',
    );

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reviewed_by: 'admin-1',
        rejection_reason: 'Insufficient evidence',
      }),
    );
  });

  it('rejects an illegal status transition without issuing an update', async () => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { status: 'suspended' }, error: null }),
      update: jest.fn().mockReturnThis(),
    };
    const repo = new SupabaseAdminRepository({ from: () => builder } as never);

    await expect(
      repo.suspendConsultant('consultant-1', 'admin-1', 'Repeated action'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('reinstates without replacing the original verified_at timestamp', async () => {
    const update = jest.fn();
    let updating = false;
    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      update: update.mockImplementation(() => {
        updating = true;
        return builder;
      }),
      maybeSingle: jest.fn(() =>
        Promise.resolve(
          updating
            ? {
                data: { user_id: 'consultant-1', status: 'verified' },
                error: null,
              }
            : { data: { status: 'suspended' }, error: null },
        ),
      ),
    };
    const repo = new SupabaseAdminRepository({ from: () => builder } as never);

    await repo.reinstateConsultant(
      'consultant-1',
      'admin-1',
      'Appeal accepted',
    );

    expect(update).toHaveBeenCalledWith({
      status: 'verified',
      suspended_at: null,
      status_reason: 'Appeal accepted',
      status_changed_by: 'admin-1',
    });
    expect(update.mock.calls[0][0]).not.toHaveProperty('verified_at');
  });
});

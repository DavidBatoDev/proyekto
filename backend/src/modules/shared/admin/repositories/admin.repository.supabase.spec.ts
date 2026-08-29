import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupabaseAdminRepository } from './admin.repository.supabase';

describe('SupabaseAdminRepository consultant enrollment lifecycle', () => {
  it('approves through the single atomic RPC with the reviewing admin', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { id: 'application-1', status: 'approved' },
      error: null,
    });
    const repo = new SupabaseAdminRepository({ rpc } as never);

    const result = await repo.approveApplication('application-1', 'admin-1');

    expect(rpc).toHaveBeenCalledWith('approve_consultant_application', {
      p_application_id: 'application-1',
      p_reviewed_by: 'admin-1',
    });
    expect(result).toMatchObject({ status: 'approved' });
  });

  it('maps the RPC status guard to 409 and missing application to 404', async () => {
    const conflictRepo = new SupabaseAdminRepository({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'INVALID_STATUS:approved' },
      }),
    } as never);
    await expect(
      conflictRepo.approveApplication('application-1', 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    const notFoundRepo = new SupabaseAdminRepository({
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'APPLICATION_NOT_FOUND' },
      }),
    } as never);
    await expect(
      notFoundRepo.approveApplication('application-1', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes reviewed_by and the reason on rejection of a submitted application', async () => {
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
    // The precondition that closes the reject-after-approve hole.
    expect(builder.eq).toHaveBeenCalledWith('status', 'submitted');
  });

  it('refuses to reject an application that is not submitted', async () => {
    const builder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      // Zero rows matched: already approved/rejected/draft.
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'No rows found' },
      }),
    };
    const repo = new SupabaseAdminRepository({ from: () => builder } as never);

    await expect(
      repo.rejectApplication('application-1', 'admin-1', 'reason'),
    ).rejects.toBeInstanceOf(ConflictException);
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

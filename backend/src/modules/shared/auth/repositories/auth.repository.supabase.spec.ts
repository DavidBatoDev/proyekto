import { SupabaseAuthRepository } from './auth.repository.supabase';

describe('SupabaseAuthRepository enrollment payload', () => {
  it('returns computed OTA flags and the new enrollment statuses', async () => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'user-1',
          consultant_profile: [{ status: 'verified' }],
          freelancer_profile: [{ status: 'paused' }],
        },
        error: null,
      }),
    };
    const repo = new SupabaseAuthRepository({ from: () => builder } as never);

    await expect(repo.getProfile('user-1')).resolves.toMatchObject({
      consultant_status: 'verified',
      freelancer_status: 'paused',
      is_consultant_verified: true,
      is_public: false,
    });
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringContaining('consultant_profiles(status)'),
    );
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringContaining('freelancer_profiles(status)'),
    );
  });
});

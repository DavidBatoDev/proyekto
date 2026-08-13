import { ConflictException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QaFixturePolicyService } from './qa-fixture-policy.service';

function harness(
  count: number | null,
  error: { message: string } | null = null,
) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => Promise.resolve({ count, error }));
  query.or = jest.fn(() => Promise.resolve({ count, error }));
  const db = { from: jest.fn(() => query) } as unknown as SupabaseClient;
  return { service: new QaFixturePolicyService(db), db };
}

describe('QaFixturePolicyService', () => {
  it('allows ordinary projects', async () => {
    const { service } = harness(0);
    await expect(
      service.assertProjectSideEffectAllowed('project-1', 'Invoice issuing'),
    ).resolves.toBeUndefined();
  });

  it('blocks registered fixture projects with a stable code', async () => {
    const { service } = harness(1);
    await expect(
      service.assertProjectSideEffectAllowed(
        'fixture-project',
        'Invoice issuing',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    try {
      await service.assertProjectSideEffectAllowed(
        'fixture-project',
        'Invoice issuing',
      );
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'QA_FIXTURE_SIDE_EFFECT_BLOCKED',
      });
    }
  });

  it('fails closed when fixture classification fails', async () => {
    const { service } = harness(null, { message: 'database unavailable' });
    await expect(
      service.assertProjectSideEffectAllowed('project-1', 'Invoice issuing'),
    ).rejects.toThrow('Could not classify QA fixture');
  });

  it('classifies either registered team as a fixture team', async () => {
    const { service } = harness(1);
    await expect(service.isFixtureTeam('team-1')).resolves.toBe(true);
  });
});

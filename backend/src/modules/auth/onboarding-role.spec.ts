import {
  accountRoleForOnboarding,
  canonicalOnboardingSettings,
  resolveOnboardingRole,
} from './onboarding-role';

describe('onboarding role mapping', () => {
  it.each([
    ['client', 'client'],
    ['talent', 'talent'],
    ['consultant', 'consultant'],
  ] as const)('maps explicit %s selection to %s', (lane, expected) => {
    expect(accountRoleForOnboarding({ lane })).toBe(expected);
  });

  it.each([
    [{ client: true, freelancer: false }, 'client'],
    [{ client: false, freelancer: true }, 'talent'],
    [{ client: true, freelancer: true }, 'talent'],
    [{ client: false, freelancer: false }, 'talent'],
  ] as const)('maps legacy intent $intent to $expected', (intent, expected) => {
    expect(
      accountRoleForOnboarding({ lane: 'client_freelancer', intent }),
    ).toBe(expected);
  });

  it('persists canonical onboarding settings without legacy intent', () => {
    expect(
      canonicalOnboardingSettings('consultant', '2026-08-10T00:00:00.000Z'),
    ).toEqual({
      lane: 'consultant',
      completed_at: '2026-08-10T00:00:00.000Z',
    });
  });

  it('never demotes an existing consultant during an onboarding replay', () => {
    expect(resolveOnboardingRole('consultant', { lane: 'client' })).toBe(
      'consultant',
    );
  });
});

import type { AccountRole } from '../../common/entities';

export interface LegacyOnboardingIntent {
  freelancer: boolean;
  client: boolean;
}

export type OnboardingSelection =
  | { lane: AccountRole }
  | { lane: 'client_freelancer'; intent: LegacyOnboardingIntent };

export interface CanonicalOnboardingSettings {
  lane: AccountRole;
  completed_at: string;
}

export function accountRoleForOnboarding(
  selection: OnboardingSelection,
): AccountRole {
  switch (selection.lane) {
    case 'client':
    case 'talent':
    case 'consultant':
      return selection.lane;
    case 'client_freelancer':
      return selection.intent.client && !selection.intent.freelancer
        ? 'client'
        : 'talent';
  }
}

export function resolveOnboardingRole(
  existingRole: AccountRole | null | undefined,
  selection: OnboardingSelection,
): AccountRole {
  const requestedRole = accountRoleForOnboarding(selection);
  return existingRole === 'consultant' ? 'consultant' : requestedRole;
}

export function canonicalOnboardingSettings(
  role: AccountRole,
  completedAt: string,
): CanonicalOnboardingSettings {
  return { lane: role, completed_at: completedAt };
}

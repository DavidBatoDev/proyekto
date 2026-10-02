import { ForbiddenException } from '@nestjs/common';
import {
  assertResolvedTeamTimeTrackingEnabled,
  ResolvedTeamRate,
  TeamTimeService,
} from './team-time.service';

function resolvedRate(
  overrides: Partial<ResolvedTeamRate> = {},
): ResolvedTeamRate {
  return {
    team_id: 'primary-team',
    time_tracking_enabled: true,
    rate_type: 'hourly',
    hourly_rate: 25,
    training_hourly_rate: 0,
    currency: 'USD',
    weekly_limit_hours: null,
    monthly_limit_hours: null,
    overtime_requires_approval: false,
    ...overrides,
  };
}

describe('assertResolvedTeamTimeTrackingEnabled', () => {
  it('accepts the exact resolved team when its time tracking is enabled', () => {
    expect(() =>
      assertResolvedTeamTimeTrackingEnabled(resolvedRate()),
    ).not.toThrow();
  });

  it('rejects a disabled resolved team even if another attached team is enabled', () => {
    const selectedPrimary = resolvedRate({
      team_id: 'disabled-primary',
      time_tracking_enabled: false,
    });
    const unrelatedContributor = resolvedRate({
      team_id: 'enabled-contributor',
      time_tracking_enabled: true,
    });

    expect(unrelatedContributor.time_tracking_enabled).toBe(true);
    expect(() =>
      assertResolvedTeamTimeTrackingEnabled(selectedPrimary),
    ).toThrow(ForbiddenException);
  });

  it('rejects a log when no delivery team can be resolved', () => {
    expect(() => assertResolvedTeamTimeTrackingEnabled(null)).toThrow(
      /No delivery team could be resolved/,
    );
  });
});

describe('healOrphanedTeamIds (retired)', () => {
  it('reports nothing healed and never touches the database', () => {
    const from = jest.fn(() => {
      throw new Error('heal must not query task_time_logs');
    });
    const service = new TeamTimeService(
      { from } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(service.healOrphanedTeamIds()).toEqual({ scanned: 0, healed: 0 });
    expect(from).not.toHaveBeenCalled();
  });
});

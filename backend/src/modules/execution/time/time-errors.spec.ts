import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ALIAS_LOCKED_MESSAGE,
  ALIAS_REVIEW_GONE_MESSAGE,
  isDeadlock,
  mapTimeDbError,
  RUNNING_TIMER_MESSAGE,
  throwTimeDb,
  TIME_ERROR_MESSAGE,
  TIME_ERROR_STATUS,
  timeError,
  timeNotFound,
  type PgErrorLike,
  type TimeErrorCode,
} from './time-errors';

/** A raise through time_raise(code, detail jsonb): message = the bare code, details = JSON text. */
function raised(
  code: string,
  detail?: Record<string, unknown> | string | null,
): PgErrorLike {
  return {
    code: 'P0001',
    message: code,
    details:
      detail === undefined || detail === null
        ? null
        : typeof detail === 'string'
          ? detail
          : JSON.stringify(detail),
    hint: null,
  };
}

function bodyOf(e: HttpException | null): Record<string, unknown> {
  expect(e).not.toBeNull();
  return (e as HttpException).getResponse() as Record<string, unknown>;
}

const RUNNING_23505: PgErrorLike = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "uq_time_entries_one_running_per_member"',
  details:
    'Key (member_user_id)=(11111111-1111-1111-1111-111111111111) already exists.',
};

describe('time-errors', () => {
  describe('the code tables', () => {
    const codes = Object.keys(TIME_ERROR_STATUS) as TimeErrorCode[];

    it('gives every code a status and non-empty copy (critic CC8: a full Record)', () => {
      expect(Object.keys(TIME_ERROR_MESSAGE).sort()).toEqual([...codes].sort());
      for (const code of codes) {
        expect(TIME_ERROR_MESSAGE[code].length).toBeGreaterThan(0);
        expect(TIME_ERROR_MESSAGE[code]).not.toContain(code);
      }
    });

    it('says Proyekto, never Prodigy, in every message', () => {
      for (const message of [
        ...Object.values(TIME_ERROR_MESSAGE),
        ALIAS_LOCKED_MESSAGE(true),
        ALIAS_LOCKED_MESSAGE(false),
        ALIAS_REVIEW_GONE_MESSAGE(true),
        ALIAS_REVIEW_GONE_MESSAGE(false),
      ]) {
        expect(message).not.toMatch(/prodigy/i);
      }
    });

    it('uses the PR-0 running-timer string and the review-gone web copy', () => {
      expect(RUNNING_TIMER_MESSAGE).toBe(
        'You already have a running timer. Stop it before starting a new one.',
      );
      expect(TIME_ERROR_MESSAGE.TIMER_ALREADY_RUNNING).toBe(
        RUNNING_TIMER_MESSAGE,
      );
      expect(TIME_ERROR_MESSAGE.TIMESHEETS_REPLACED_REVIEW).toBe(
        ALIAS_REVIEW_GONE_MESSAGE(false),
      );
    });

    it('builds the origin-aware alias copy (D06)', () => {
      expect(ALIAS_LOCKED_MESSAGE(true)).toBe(
        "This week was sent for approval, so it can't be changed here. Update the app to see timesheets.",
      );
      expect(ALIAS_LOCKED_MESSAGE(false)).toBe(
        "This week was sent for approval, so it can't be changed here. Reload Proyekto to see timesheets.",
      );
      expect(ALIAS_REVIEW_GONE_MESSAGE(true)).toBe(
        'Update the app to approve timesheets.',
      );
      expect(ALIAS_REVIEW_GONE_MESSAGE(false)).toBe(
        'Approvals now happen by timesheet. Reload Proyekto.',
      );
    });
  });

  describe('timeError', () => {
    it.each<[number, new (...args: never[]) => HttpException]>([
      [403, ForbiddenException],
      [404, NotFoundException],
      [409, ConflictException],
      [410, GoneException],
      [422, UnprocessableEntityException],
    ])('returns the Nest exception for status %i', (status, cls) => {
      const code = (Object.keys(TIME_ERROR_STATUS) as TimeErrorCode[]).find(
        (c) => TIME_ERROR_STATUS[c] === status,
      )!;
      const e = timeError(code);
      expect(e).toBeInstanceOf(cls);
      expect(e.getStatus()).toBe(status);
    });

    it('builds { code, message, ...extras } with the default copy', () => {
      const e = timeError('STALE_REVISION', undefined, {
        timesheet_id: 's1',
        expected: 2,
        actual: 3,
      });
      expect(bodyOf(e)).toEqual({
        code: 'STALE_REVISION',
        message: TIME_ERROR_MESSAGE.STALE_REVISION,
        timesheet_id: 's1',
        expected: 2,
        actual: 3,
      });
    });

    it('keeps a caller message', () => {
      expect(bodyOf(timeError('NO_LOGGING_CONTEXT', 'Custom.')).message).toBe(
        'Custom.',
      );
    });

    it('drops the keys HttpExceptionFilter owns (D50)', () => {
      const body = bodyOf(
        timeError('TIMESHEET_LOCKED', undefined, {
          status: 'submitted',
          message: 'x',
          code: 'OTHER',
          path: '/x',
          timestamp: 't',
          statusCode: 500,
          reason: 'period',
        }),
      );
      expect(body).toEqual({
        code: 'TIMESHEET_LOCKED',
        message: TIME_ERROR_MESSAGE.TIMESHEET_LOCKED,
        reason: 'period',
      });
    });

    it('timeNotFound picks the code by kind', () => {
      expect(bodyOf(timeNotFound()).code).toBe('TIME_NOT_FOUND');
      expect(bodyOf(timeNotFound('entry')).message).toBe(
        TIME_ERROR_MESSAGE.TIME_NOT_FOUND,
      );
      expect(bodyOf(timeNotFound('timesheet')).code).toBe(
        'TIMESHEET_NOT_FOUND',
      );
      const scope = timeNotFound('scope');
      expect(scope).toBeInstanceOf(NotFoundException);
      expect(bodyOf(scope).code).toBe('TIME_NOT_FOUND');
      expect(bodyOf(scope).message).toMatch(
        /doesn't exist or you can't open it/,
      );
    });
  });

  describe('mapTimeDbError', () => {
    it('returns null for nothing, non-sentinels and invariant failures', () => {
      expect(mapTimeDbError(null)).toBeNull();
      expect(mapTimeDbError(undefined)).toBeNull();
      expect(
        mapTimeDbError({
          code: '42P01',
          message: 'relation "x" does not exist',
        }),
      ).toBeNull();
      expect(
        mapTimeDbError({
          code: 'P0001',
          message: 'M1 precheck: public.timesheets already exists',
        }),
      ).toBeNull();
      expect(mapTimeDbError(raised('TIMESHEET_ENSURE_FAILED'))).toBeNull();
      expect(
        mapTimeDbError(raised('ENGAGEMENT_ASSIGNMENT_DELETE_FORBIDDEN')),
      ).toBeNull();
      expect(mapTimeDbError(raised('TIMESHEET_LOCKEDX'))).toBeNull();
    });

    describe('23505', () => {
      it('maps only the one-running index to 409 TIMER_ALREADY_RUNNING', () => {
        const e = mapTimeDbError(RUNNING_23505);
        expect(e).toBeInstanceOf(ConflictException);
        expect(bodyOf(e)).toEqual({
          code: 'TIMER_ALREADY_RUNNING',
          message: RUNNING_TIMER_MESSAGE,
        });
      });

      it('maps the alias variant to the PR-0 400 (D07)', () => {
        const e = mapTimeDbError(RUNNING_23505, { alias: { native: false } });
        expect(e).toBeInstanceOf(BadRequestException);
        expect(bodyOf(e).message).toBe(RUNNING_TIMER_MESSAGE);
      });

      it('finds the index name in details too', () => {
        const e = mapTimeDbError({
          code: '23505',
          message: 'duplicate key',
          details: 'uq_time_entries_one_running_per_member',
        });
        expect(bodyOf(e).code).toBe('TIMER_ALREADY_RUNNING');
      });

      it('ignores any other unique violation', () => {
        expect(
          mapTimeDbError({
            code: '23505',
            message:
              'duplicate key value violates unique constraint "timesheets_pkey"',
          }),
        ).toBeNull();
      });
    });

    describe('locks', () => {
      it('TIME_ENTRY_LOCKED → 409 TIMESHEET_LOCKED {reason:entry, lock, entry_id}', () => {
        const e = mapTimeDbError(
          raised('TIME_ENTRY_LOCKED', { entry_id: 'e1', reason: 'paid' }),
        );
        expect(e).toBeInstanceOf(ConflictException);
        expect(bodyOf(e)).toEqual({
          code: 'TIMESHEET_LOCKED',
          message: TIME_ERROR_MESSAGE.TIMESHEET_LOCKED,
          reason: 'entry',
          lock: 'paid',
          entry_id: 'e1',
        });
      });

      it('TIME_PERIOD_LOCKED → 409 TIMESHEET_LOCKED {reason:period, timesheet_id, sheet_status}, never status (D50)', () => {
        const e = mapTimeDbError(
          raised('TIME_PERIOD_LOCKED', {
            timesheet_id: 's1',
            status: 'submitted',
          }),
        );
        const body = bodyOf(e);
        expect(e!.getStatus()).toBe(409);
        expect(body).toMatchObject({
          code: 'TIMESHEET_LOCKED',
          reason: 'period',
          timesheet_id: 's1',
          sheet_status: 'submitted',
        });
        expect(body).not.toHaveProperty('status');
        expect(body.message).toMatch(/Withdraw it to add time/);
      });

      it('an approved period gets copy without a withdraw hint', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('TIME_PERIOD_LOCKED', {
              timesheet_id: 's1',
              status: 'approved',
            }),
          ),
        );
        expect(body.sheet_status).toBe('approved');
        expect(body.message).not.toMatch(/Withdraw/);
      });

      it.each([true, false])(
        'uses the origin-aware alias copy for both locks (native=%s)',
        (native) => {
          for (const err of [
            raised('TIME_ENTRY_LOCKED', {
              entry_id: 'e1',
              reason: 'sheet_submitted',
            }),
            raised('TIME_PERIOD_LOCKED', {
              timesheet_id: 's1',
              status: 'submitted',
            }),
          ]) {
            const e = mapTimeDbError(err, { alias: { native } });
            expect(e!.getStatus()).toBe(409);
            expect(bodyOf(e)).toMatchObject({
              code: 'TIMESHEET_LOCKED',
              message: ALIAS_LOCKED_MESSAGE(native),
            });
          }
        },
      );
    });

    describe('timesheet sentinels', () => {
      it('TIMESHEET_NOT_FOUND → 404', () => {
        const e = mapTimeDbError(
          raised('TIMESHEET_NOT_FOUND', { timesheet_id: 's1' }),
        );
        expect(e).toBeInstanceOf(NotFoundException);
        expect(bodyOf(e)).toEqual({
          code: 'TIMESHEET_NOT_FOUND',
          message: TIME_ERROR_MESSAGE.TIMESHEET_NOT_FOUND,
        });
      });

      it('TIMESHEET_DECIDER_INVALID → 409 TIMESHEET_TRANSITION_INVALID {reason:not_allowed} (D33)', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised(
              'TIMESHEET_DECIDER_INVALID',
              'legacy decisions are migration-only',
            ),
          ),
        );
        expect(body).toEqual({
          code: 'TIMESHEET_TRANSITION_INVALID',
          message: TIME_ERROR_MESSAGE.TIMESHEET_TRANSITION_INVALID,
          reason: 'not_allowed',
        });
      });

      it.each(['TIMESHEET_IMMUTABLE', 'TIMESHEET_DELETE_FORBIDDEN'])(
        '%s → 409 {reason:state}',
        (code) => {
          const e = mapTimeDbError(
            raised(code, 'approver_scope is frozen at submit'),
          );
          expect(e!.getStatus()).toBe(409);
          expect(bodyOf(e)).toMatchObject({
            code: 'TIMESHEET_TRANSITION_INVALID',
            reason: 'state',
          });
        },
      );

      it('TIMESHEET_TRANSITION_INVALID with JSON DETAIL carries it as extras', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('TIMESHEET_TRANSITION_INVALID', {
              reason: 'too_early',
              timesheet_id: 's1',
            }),
          ),
        );
        expect(body).toMatchObject({
          code: 'TIMESHEET_TRANSITION_INVALID',
          reason: 'too_early',
          timesheet_id: 's1',
        });
      });

      it('TIMESHEET_TRANSITION_INVALID with text DETAIL (the guard) → {reason:state, detail}', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('TIMESHEET_TRANSITION_INVALID', 'open -> approved'),
          ),
        );
        expect(body).toMatchObject({
          code: 'TIMESHEET_TRANSITION_INVALID',
          reason: 'state',
          detail: 'open -> approved',
        });
      });

      it('TIMESHEET_TRANSITION_INVALID with no DETAIL → {reason:state}', () => {
        expect(
          bodyOf(mapTimeDbError(raised('TIMESHEET_TRANSITION_INVALID'))),
        ).toMatchObject({ reason: 'state' });
      });

      it('STALE_REVISION → 409 with DETAIL json', () => {
        const e = mapTimeDbError(
          raised('STALE_REVISION', {
            timesheet_id: 's1',
            expected: 1,
            actual: 2,
          }),
        );
        expect(e!.getStatus()).toBe(409);
        expect(bodyOf(e)).toMatchObject({
          code: 'STALE_REVISION',
          timesheet_id: 's1',
          expected: 1,
          actual: 2,
        });
        expect(
          bodyOf(
            mapTimeDbError(
              raised('STALE_REVISION', {
                reason: 'entry_set',
                timesheet_id: 's1',
              }),
            ),
          ),
        ).toMatchObject({
          reason: 'entry_set',
        });
      });

      it('TIMESHEET_HAS_SETTLED_ENTRIES → 409 with DETAIL json', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('TIMESHEET_HAS_SETTLED_ENTRIES', {
              timesheet_id: 's1',
              reason: 'paid',
            }),
          ),
        );
        expect(body).toMatchObject({
          code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
          timesheet_id: 's1',
          reason: 'paid',
        });
      });

      it('TIMESHEET_SCOPE_REQUIRED → 422 LOGGING_FOR_INVALID {detail}', () => {
        const e = mapTimeDbError(
          raised('TIMESHEET_SCOPE_REQUIRED', { reason: 'scope' }),
        );
        expect(e).toBeInstanceOf(UnprocessableEntityException);
        expect(bodyOf(e)).toEqual({
          code: 'LOGGING_FOR_INVALID',
          message: TIME_ERROR_MESSAGE.LOGGING_FOR_INVALID,
          detail: { reason: 'scope' },
        });
        expect(
          bodyOf(mapTimeDbError(raised('TIMESHEET_SCOPE_REQUIRED'))),
        ).toEqual({
          code: 'LOGGING_FOR_INVALID',
          message: TIME_ERROR_MESSAGE.LOGGING_FOR_INVALID,
        });
      });
    });

    describe('entry and assignment sentinels', () => {
      it.each<[string, number]>([
        ['TIME_ENTRY_NO_PROJECT_ACCESS', 403],
        ['TIME_ENTRY_NOT_ON_PROJECT_TEAM', 403],
        ['TIME_ENTRY_NOT_WORKSPACE_MEMBER', 403],
        ['PAYOUT_SELF_NOT_ALLOWED', 403],
        ['LOGGING_FOR_INVALID', 422],
        ['TIME_POLICY_INVALID', 422],
        ['TEAM_RATES_REQUIRE_APPROVAL', 422],
        ['FIXED_RATE_NOT_PAYABLE_BY_ENTRY', 422],
        ['ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER', 422],
        ['ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED', 422],
        ['TIME_LOG_OUTSIDE_ASSIGNMENT_WINDOW', 422],
        ['APPROVED_TIME_ASSIGNMENT_LOCKED', 409],
        ['INVOICE_TIME_ENTRY_NOT_BILLABLE', 409],
        ['LEGACY_CONTRACT_AMBIGUOUS', 409],
      ])('%s → %i with its own code and default copy', (code, status) => {
        const e = mapTimeDbError(raised(code));
        expect(e!.getStatus()).toBe(status);
        expect(bodyOf(e)).toMatchObject({
          code,
          message: TIME_ERROR_MESSAGE[code as TimeErrorCode],
        });
      });

      it('carries a text DETAIL as { detail }', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('TIME_POLICY_INVALID', 'unknown timezone Mars/Base'),
          ),
        );
        expect(body).toEqual({
          code: 'TIME_POLICY_INVALID',
          message: TIME_ERROR_MESSAGE.TIME_POLICY_INVALID,
          detail: 'unknown timezone Mars/Base',
        });
      });

      it('reads a sentinel that has trailing text after it', () => {
        expect(
          bodyOf(
            mapTimeDbError({
              code: 'P0001',
              message: 'TIME_ENTRY_NO_PROJECT_ACCESS: no row',
            }),
          ).code,
        ).toBe('TIME_ENTRY_NO_PROJECT_ACCESS');
      });

      it.each([
        'TIME_LOG_ASSIGNMENT_NOT_FOUND',
        'TIME_LOG_ASSIGNMENT_PROJECT_MISMATCH',
        'TIME_LOG_ASSIGNMENT_WORKER_MISMATCH',
        'TIME_LOG_ASSIGNMENT_INVALID',
      ])('%s → 422 TIME_LOG_ASSIGNMENT_INVALID {detail: <code>}', (code) => {
        const e = mapTimeDbError(raised(code));
        expect(e!.getStatus()).toBe(422);
        expect(bodyOf(e)).toMatchObject({
          code: 'TIME_LOG_ASSIGNMENT_INVALID',
          detail: code,
        });
      });

      it('renames a JSON `status` to `sheet_status` on the generic path (D50)', () => {
        const body = bodyOf(
          mapTimeDbError(
            raised('INVOICE_TIME_ENTRY_NOT_BILLABLE', {
              status: 'issued',
              entry_id: 'e1',
            }),
          ),
        );
        expect(body).not.toHaveProperty('status');
        expect(body).toMatchObject({ sheet_status: 'issued', entry_id: 'e1' });
      });
    });
  });

  describe('throwTimeDb', () => {
    it('throws the mapped exception', () => {
      expect(() =>
        throwTimeDb(
          raised('TIME_ENTRY_LOCKED', { entry_id: 'e1', reason: 'billed' }),
        ),
      ).toThrow(ConflictException);
    });

    it('throws a plain Error (a logged 500) otherwise', () => {
      let thrown: unknown;
      try {
        throwTimeDb({ code: '42P01', message: 'relation "x" does not exist' });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(HttpException);
      expect((thrown as Error).message).toBe('relation "x" does not exist');
    });

    it('passes the alias context through', () => {
      expect(() =>
        throwTimeDb(RUNNING_23505, { alias: { native: true } }),
      ).toThrow(BadRequestException);
    });
  });

  it('isDeadlock is 40P01 only', () => {
    expect(isDeadlock({ code: '40P01', message: 'deadlock detected' })).toBe(
      true,
    );
    expect(isDeadlock({ code: '40001' })).toBe(false);
    expect(isDeadlock(null)).toBe(false);
    expect(isDeadlock(undefined)).toBe(false);
  });
});

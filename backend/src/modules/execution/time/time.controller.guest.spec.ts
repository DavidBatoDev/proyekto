import { readdirSync } from 'fs';
import { join } from 'path';
import { HttpException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CronSecretGuard } from '../../../common/guards/cron-secret.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { TeamTimeLegacyController } from './controllers/team-time-legacy.controller';
import { TimeCronController } from './controllers/time-cron.controller';
import { TimeEntriesController } from './controllers/time-entries.controller';
import { TimePoliciesController } from './controllers/time-policies.controller';
import { TimeReportsController } from './controllers/time-reports.controller';
import { TimesheetsController } from './controllers/timesheets.controller';
import { TimeGuestGuard } from './guards/time-guest.guard';
import { TimeModule } from './time.module';
import { EMPTY_TIME_OVERVIEW } from './time.types';

/**
 * Guests (E66 + D08). A guest session (`X-Guest-User-Id`) passes SupabaseAuthGuard with `is_guest: true`, and
 * every handler of the new time API and of the alias (TeamTimeLegacyController) must then answer 404 (never
 * 403: a guest learns nothing about what exists), except:
 *  - `GET time/me/overview`: the empty overview, so the signed-in shell renders;
 *  - `GET time/me/running` and the alias `GET logs/me/running`: `null` (every client, guests included, polls
 *    them every 3–30 s);
 *  - the two `@Public` cron routes, which are not user routes at all (CronSecretGuard).
 *
 * Handlers are enumerated from Nest's route metadata, so a new route is covered (and 404s guests) without
 * touching this file; a new controller file fails the inventory test until it is listed here.
 */

type ControllerClass = abstract new (...args: never[]) => unknown;

const CONTROLLERS: Array<{ file: string; cls: ControllerClass }> = [
  { file: 'team-time-legacy.controller.ts', cls: TeamTimeLegacyController },
  { file: 'time-cron.controller.ts', cls: TimeCronController },
  { file: 'time-entries.controller.ts', cls: TimeEntriesController },
  { file: 'time-policies.controller.ts', cls: TimePoliciesController },
  { file: 'time-reports.controller.ts', cls: TimeReportsController },
  { file: 'timesheets.controller.ts', cls: TimesheetsController },
];

/** The alias controller's base path (`/api/<ALIAS>/...`). */
const ALIAS = 'team-time';

/** `METHOD path` of every handler a guest may reach, and why. */
const GUEST_EMPTY_SHAPE = new Set([
  'GET time/me/overview',
  'GET time/me/running',
  `GET ${ALIAS}/logs/me/running`,
]);
const PUBLIC_CRON = new Set([
  'POST time/cron/run',
  `POST ${ALIAS}/cron/heal-orphaned-logs`,
]);

interface Route {
  key: string;
  controller: string;
  name: string;
  cls: ControllerClass;
  handler: (...args: unknown[]) => unknown;
}

function joinPath(base: unknown, path: unknown): string {
  const parts = [base, path]
    .map((part) => (typeof part === 'string' ? part : ''))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0);
  return parts.join('/');
}

function routesOf(cls: ControllerClass): Route[] {
  const proto = cls.prototype as object;
  const base: unknown = Reflect.getMetadata(PATH_METADATA, cls);
  const routes: Route[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    const handler: unknown = descriptor?.value;
    if (typeof handler !== 'function') continue;
    const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
    if (typeof method !== 'number') continue;
    const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    const paths = Array.isArray(path) ? (path as unknown[]) : [path];
    for (const p of paths) {
      routes.push({
        key: `${RequestMethod[method]} ${joinPath(base, p)}`,
        controller: cls.name,
        name,
        cls,
        handler: handler as (...args: unknown[]) => unknown,
      });
    }
  }
  return routes;
}

const ROUTES: Route[] = CONTROLLERS.flatMap(({ cls }) => routesOf(cls));

const GUEST: AuthenticatedUser = { id: 'guest-1', is_guest: true };
const MEMBER: AuthenticatedUser = { id: 'user-1' };

function contextFor(route: Route, user: AuthenticatedUser) {
  return {
    getHandler: () => route.handler,
    getClass: () => route.cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guardOutcome(
  route: Route,
  user: AuthenticatedUser,
): { passed: true } | { passed: false; status: number; code: unknown } {
  const guard = new TimeGuestGuard(new Reflector());
  try {
    return { passed: guard.canActivate(contextFor(route, user)) as true };
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code?: unknown };
    return { passed: false, status: error.getStatus(), code: body.code };
  }
}

describe('time controllers: guest gate (E66, D08)', () => {
  it('lists every controller file in time/controllers/ and TimeModule registers exactly those', () => {
    const files = readdirSync(join(__dirname, 'controllers'))
      .filter(
        (file) => file.endsWith('.controller.ts') && !file.endsWith('.spec.ts'),
      )
      .sort();
    expect(files).toEqual(CONTROLLERS.map(({ file }) => file).sort());

    const registered = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TimeModule,
    ) as ControllerClass[];
    expect(new Set(registered)).toEqual(
      new Set(CONTROLLERS.map(({ cls }) => cls)),
    );
    expect(registered).toHaveLength(CONTROLLERS.length);
  });

  it.each(CONTROLLERS.map(({ cls }) => [cls.name, cls] as const))(
    '%s runs SupabaseAuthGuard then TimeGuestGuard on every handler',
    (_name, cls) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, cls)).toEqual([
        SupabaseAuthGuard,
        TimeGuestGuard,
      ]);
    },
  );

  it('enumerates the routes: all 30 alias routes and no duplicate METHOD path', () => {
    const keys = ROUTES.map((route) => route.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      ROUTES.filter((route) => route.cls === TeamTimeLegacyController),
    ).toHaveLength(30);
    for (const { cls } of CONTROLLERS) {
      expect(ROUTES.some((route) => route.cls === cls)).toBe(true);
    }
    // Every exception names a real route, so a renamed path cannot make an assertion vacuous.
    for (const key of [...GUEST_EMPTY_SHAPE, ...PUBLIC_CRON]) {
      expect(keys).toContain(key);
    }
  });

  it.each(
    ROUTES.filter(
      (route) =>
        !GUEST_EMPTY_SHAPE.has(route.key) && !PUBLIC_CRON.has(route.key),
    ).map((route) => [route.key, route] as const),
  )('%s answers a guest 404 TIME_NOT_FOUND', (_key, route) => {
    expect(guardOutcome(route, GUEST)).toEqual({
      passed: false,
      status: 404,
      code: 'TIME_NOT_FOUND',
    });
  });

  it.each([...GUEST_EMPTY_SHAPE, ...PUBLIC_CRON].map((key) => [key] as const))(
    '%s lets a guest through the guest guard',
    (key) => {
      const route = ROUTES.find((candidate) => candidate.key === key)!;
      expect(guardOutcome(route, GUEST)).toEqual({ passed: true });
    },
  );

  it('lets a signed-in member through the guest guard on every route', () => {
    for (const route of ROUTES) {
      expect([route.key, guardOutcome(route, MEMBER)]).toEqual([
        route.key,
        { passed: true },
      ]);
    }
  });

  it('keeps the @Public cron routes behind CronSecretGuard', () => {
    for (const key of PUBLIC_CRON) {
      const route = ROUTES.find((candidate) => candidate.key === key)!;
      expect(Reflect.getMetadata(GUARDS_METADATA, route.handler)).toEqual([
        CronSecretGuard,
      ]);
    }
  });

  describe('empty shapes for guests (no service call)', () => {
    function buildEntriesController() {
      const entries = { getRunning: jest.fn() };
      const loggingContext = {};
      const timesheets = { overview: jest.fn() };
      const controller = new TimeEntriesController(
        entries as never,
        loggingContext as never,
        timesheets as never,
      );
      return { controller, entries, timesheets };
    }

    it('GET time/me/overview returns a fresh EMPTY_TIME_OVERVIEW', async () => {
      const { controller, timesheets } = buildEntriesController();

      const first = await controller.overview(GUEST, {});
      const second = await controller.overview(GUEST, {});

      expect(first).toEqual(EMPTY_TIME_OVERVIEW);
      expect(first).not.toBe(EMPTY_TIME_OVERVIEW);
      expect(first.contexts).not.toBe(EMPTY_TIME_OVERVIEW.contexts);
      expect(first.workspace_time_admin).not.toBe(
        EMPTY_TIME_OVERVIEW.workspace_time_admin,
      );
      expect(first.contexts).not.toBe(second.contexts);
      expect(timesheets.overview).not.toHaveBeenCalled();
    });

    it('GET time/me/running returns null', async () => {
      const { controller, entries } = buildEntriesController();

      await expect(controller.running(GUEST)).resolves.toBeNull();
      expect(entries.getRunning).not.toHaveBeenCalled();
    });

    it('alias GET logs/me/running returns null', async () => {
      const entries = { getRunning: jest.fn() };
      const controller = new TeamTimeLegacyController(
        entries as never,
        {} as never,
      );

      await expect(controller.getMyRunningLog(GUEST)).resolves.toBeNull();
      expect(entries.getRunning).not.toHaveBeenCalled();
    });
  });
});

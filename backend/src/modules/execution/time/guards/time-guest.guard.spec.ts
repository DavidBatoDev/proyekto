import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../../../../common/decorators/public.decorator';
import {
  AllowGuestEmptyShape,
  TIME_GUEST_EMPTY_SHAPE,
  TimeGuestGuard,
} from './time-guest.guard';

@Controller('time')
class FixtureController {
  @Get('me/entries')
  entries() {
    return [];
  }

  @Get('me/overview')
  @AllowGuestEmptyShape()
  overview() {
    return {};
  }

  @Get('cron/run')
  @Public()
  cron() {
    return {};
  }
}

@AllowGuestEmptyShape()
@Controller('time-empty')
class EmptyShapeController {
  @Get('x')
  x() {
    return null;
  }
}

type Ctor = new (...args: never[]) => unknown;

/** The decorated method as Nest's ExecutionContext.getHandler() returns it. */
function handlerOf(cls: Ctor, name: string): unknown {
  return (cls.prototype as Record<string, unknown>)[name];
}

function contextFor(
  cls: Ctor,
  name: string,
  user?: { id: string; is_guest?: boolean },
) {
  return {
    getHandler: () => handlerOf(cls, name),
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('TimeGuestGuard', () => {
  const guard = new TimeGuestGuard(new Reflector());

  it('lets a signed-in user through', () => {
    expect(
      guard.canActivate(contextFor(FixtureController, 'entries', { id: 'u1' })),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor(FixtureController, 'entries', { id: 'u1', is_guest: false }),
      ),
    ).toBe(true);
  });

  it('answers a guest with 404 TIME_NOT_FOUND, never 403 (D08)', () => {
    let thrown: unknown;
    try {
      guard.canActivate(
        contextFor(FixtureController, 'entries', { id: 'g1', is_guest: true }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as NotFoundException).getResponse()).toMatchObject({
      code: 'TIME_NOT_FOUND',
    });
  });

  it('lets a guest reach a handler marked AllowGuestEmptyShape', () => {
    expect(
      guard.canActivate(
        contextFor(FixtureController, 'overview', { id: 'g1', is_guest: true }),
      ),
    ).toBe(true);
  });

  it('honours AllowGuestEmptyShape on the class', () => {
    expect(
      guard.canActivate(
        contextFor(EmptyShapeController, 'x', { id: 'g1', is_guest: true }),
      ),
    ).toBe(true);
  });

  it('passes public routes through untouched, even with a guest or no user', () => {
    expect(
      guard.canActivate(
        contextFor(FixtureController, 'cron', { id: 'g1', is_guest: true }),
      ),
    ).toBe(true);
    expect(guard.canActivate(contextFor(FixtureController, 'cron'))).toBe(true);
  });

  it('leaves a request without a user to the auth guard', () => {
    expect(guard.canActivate(contextFor(FixtureController, 'entries'))).toBe(
      true,
    );
  });

  it('sets the documented metadata key', () => {
    expect(
      new Reflector().get(
        TIME_GUEST_EMPTY_SHAPE,
        handlerOf(FixtureController, 'overview') as () => unknown,
      ),
    ).toBe(true);
  });
});

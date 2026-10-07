import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { MeetingsService } from '../meetings.service';
import type { GoogleOAuthService } from './google-oauth.service';
import { GoogleController } from './google.controller';

const user = { id: 'user-1' } as never;

function makeOAuth() {
  return {
    getStatus: jest.fn(),
    buildConsentUrl: jest.fn().mockResolvedValue('https://accounts.google/x'),
    consumeState: jest.fn(),
    exchangeCode: jest.fn(),
    storeConnection: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    safeReturnPath: jest.fn((p?: string | null) =>
      p === '/settings/integrations' ? p : '/meetings',
    ),
  };
}

function makeRes() {
  return { redirect: jest.fn() };
}

describe('GoogleController', () => {
  let oauth: ReturnType<typeof makeOAuth>;
  let meetings: { listGoogleEvents: jest.Mock };
  let controller: GoogleController;

  beforeEach(() => {
    oauth = makeOAuth();
    meetings = {
      listGoogleEvents: jest
        .fn()
        .mockResolvedValue({ connected: true, events: [] }),
    };
    const config = {
      get: jest.fn(() => 'https://www.proyekto.tech/'),
    };
    controller = new GoogleController(
      oauth as unknown as GoogleOAuthService,
      meetings as unknown as MeetingsService,
      config as unknown as ConfigService,
    );
  });

  describe('events', () => {
    it('passes a valid window through to the service', async () => {
      const query = {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-12-01T00:00:00.000Z',
      };
      await expect(controller.events(user, query)).resolves.toEqual({
        connected: true,
        events: [],
      });
      expect(meetings.listGoogleEvents).toHaveBeenCalledWith('user-1', query);
    });

    it('rejects an inverted window', () => {
      expect(() =>
        controller.events(user, {
          from: '2026-12-01T00:00:00.000Z',
          to: '2026-09-01T00:00:00.000Z',
        }),
      ).toThrow(/after/);
    });

    it('rejects a window wider than a calendar view', () => {
      expect(() =>
        controller.events(user, {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-12-31T00:00:00.000Z',
        }),
      ).toThrow(/too large/);
      expect(meetings.listGoogleEvents).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('forwards the requested return path', async () => {
      await expect(
        controller.connect(user, { returnTo: '/settings/integrations' }),
      ).resolves.toEqual({ url: 'https://accounts.google/x' });
      expect(oauth.buildConsentUrl).toHaveBeenCalledWith(
        'user-1',
        '/settings/integrations',
      );
    });
  });

  describe('callback', () => {
    it('stores the connection and returns to the requested page', async () => {
      const res = makeRes();
      oauth.consumeState.mockResolvedValue({
        userId: 'user-1',
        returnTo: '/settings/integrations',
      });
      oauth.exchangeCode.mockResolvedValue({ userId: 'user-1' });

      await controller.callback(
        'code',
        'state',
        undefined,
        res as unknown as Response,
      );

      expect(oauth.exchangeCode).toHaveBeenCalledWith('code', 'user-1');
      expect(oauth.storeConnection).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'https://www.proyekto.tech/settings/integrations?google=connected',
      );
    });

    it('reports a cancelled consent as denied and still consumes the state', async () => {
      const res = makeRes();
      oauth.consumeState.mockResolvedValue({
        userId: 'user-1',
        returnTo: '/settings/integrations',
      });

      await controller.callback(
        undefined,
        'state',
        'access_denied',
        res as unknown as Response,
      );

      expect(oauth.consumeState).toHaveBeenCalledWith('state');
      expect(oauth.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'https://www.proyekto.tech/settings/integrations?google=error&reason=denied',
      );
    });

    it('reports an unknown state as expired', async () => {
      const res = makeRes();
      oauth.consumeState.mockResolvedValue(null);

      await controller.callback(
        'code',
        'stale',
        undefined,
        res as unknown as Response,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        'https://www.proyekto.tech/meetings?google=error&reason=expired',
      );
    });

    it('reports a failed token exchange without leaking details', async () => {
      const res = makeRes();
      oauth.consumeState.mockResolvedValue({
        userId: 'user-1',
        returnTo: '/meetings',
      });
      oauth.exchangeCode.mockRejectedValue(new Error('invalid_client'));

      await controller.callback(
        'code',
        'state',
        undefined,
        res as unknown as Response,
      );

      expect(oauth.storeConnection).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'https://www.proyekto.tech/meetings?google=error&reason=failed',
      );
    });
  });
});

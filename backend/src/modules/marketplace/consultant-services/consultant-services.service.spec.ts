/* eslint-disable @typescript-eslint/unbound-method --
 * `repo` is a jest mock object; passing its members to expect() is an
 * identity check on the mock, never a call, so `this` scoping is
 * irrelevant. Same rationale as guests.controller.spec.ts. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConsultantServicesService } from './consultant-services.service';
import type { ConsultantService } from './consultant-services.types';
import type { ConsultantServicesRepository } from './repositories/consultant-services.repository.interface';

function service(over: Partial<ConsultantService> = {}): ConsultantService {
  return {
    id: 'svc-1',
    user_id: 'me',
    subcategory_id: null,
    title: 'Google Ads audit',
    description: null,
    cover_url: null,
    starting_price: null,
    currency: 'USD',
    price_unit: 'project',
    delivery_days: null,
    status: 'draft',
    position: 0,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    ...over,
  };
}

describe('ConsultantServicesService', () => {
  const repo: jest.Mocked<ConsultantServicesRepository> = {
    findAllByOwner: jest.fn(),
    findPublishedByOwner: jest.fn(),
    findStartingPrices: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    nextPosition: jest.fn(),
    reorder: jest.fn(),
  };
  const cacheInvalidation = { invalidateConsultantsCache: jest.fn() };
  const subject = new ConsultantServicesService(
    repo,
    cacheInvalidation as unknown as ConstructorParameters<
      typeof ConsultantServicesService
    >[1],
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAllByOwner.mockResolvedValue([]);
    repo.nextPosition.mockResolvedValue(0);
    repo.create.mockResolvedValue(service());
    repo.update.mockResolvedValue(service());
  });

  describe('create', () => {
    it('appends after the last service rather than colliding at position 0', async () => {
      repo.nextPosition.mockResolvedValue(7);

      await subject.create('me', { title: 'Audit' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'me', position: 7 }),
      );
    });

    it('refuses past the cap with a sentence, not a constraint name', async () => {
      repo.findAllByOwner.mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => service({ id: `s${i}` })),
      );

      await expect(subject.create('me', { title: 'One more' })).rejects.toThrow(
        /up to 40 services/,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    /**
     * `consultant_services_published_needs_price` is the real guarantee. This
     * only decides what the consultant reads when they hit it — a Postgres
     * constraint name surfacing in the UI is the failure mode being avoided.
     */
    it('refuses to publish an unpriced service, and says why', async () => {
      repo.findById.mockResolvedValue(service({ starting_price: null }));

      await expect(
        subject.update('me', 'svc-1', { status: 'published' }),
      ).rejects.toThrow(/starting price before publishing/);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('publishes when the price arrives in the same request', async () => {
      repo.findById.mockResolvedValue(service({ starting_price: null }));

      await subject.update('me', 'svc-1', {
        status: 'published',
        starting_price: 50,
      });

      expect(repo.update).toHaveBeenCalled();
    });

    it('publishes when the price was already stored', async () => {
      repo.findById.mockResolvedValue(service({ starting_price: 50 }));

      await subject.update('me', 'svc-1', { status: 'published' });

      expect(repo.update).toHaveBeenCalled();
    });

    it("refuses to touch somebody else's service", async () => {
      repo.findById.mockResolvedValue(service({ user_id: 'someone-else' }));

      await expect(
        subject.update('me', 'svc-1', { title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s on a service that does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(subject.update('me', 'nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  /**
   * The public consultant profile is cached and carries this catalog. A write
   * that skips invalidation leaves a published service invisible for a whole
   * TTL, which reads to the consultant as "publishing is broken".
   */
  it.each([
    ['create', async () => subject.create('me', { title: 'Audit' })],
    [
      'update',
      async () => {
        repo.findById.mockResolvedValue(service({ starting_price: 10 }));
        await subject.update('me', 'svc-1', { title: 'Renamed' });
      },
    ],
    [
      'remove',
      async () => {
        repo.findById.mockResolvedValue(service());
        await subject.remove('me', 'svc-1');
      },
    ],
    ['reorder', async () => subject.reorder('me', { items: [] })],
  ])('purges the cached public profile on %s', async (_name, run) => {
    await run();

    expect(cacheInvalidation.invalidateConsultantsCache).toHaveBeenCalledWith(
      'me',
    );
  });
});

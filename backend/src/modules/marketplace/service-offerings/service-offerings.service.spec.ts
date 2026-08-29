/* eslint-disable @typescript-eslint/unbound-method --
 * `repo` is a jest mock object; passing its members to expect() is an
 * identity check on the mock, never a call, so `this` scoping is
 * irrelevant. Same rationale as guests.controller.spec.ts. */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServiceOfferingsService } from './service-offerings.service';
import type { ServiceOffering } from './service-offerings.types';
import type { ServiceOfferingsRepository } from './repositories/service-offerings.repository.interface';

function service(over: Partial<ServiceOffering> = {}): ServiceOffering {
  return {
    id: 'svc-1',
    user_id: 'me',
    subcategory_id: null,
    title: 'Google Ads audit',
    description: null,
    description_sections: [],
    cover_url: null,
    gallery_urls: [],
    starting_price: null,
    currency: 'USD',
    price_unit: 'project',
    delivery_days: null,
    status: 'draft',
    like_count: 0,
    position: 0,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
    ...over,
  };
}

describe('ServiceOfferingsService', () => {
  const repo: jest.Mocked<ServiceOfferingsRepository> = {
    findAllByOwner: jest.fn(),
    findPublishedByOwner: jest.fn(),
    findStartingPrices: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    nextPosition: jest.fn(),
    reorder: jest.fn(),
    replacePackages: jest.fn(),
    findPackagesByOfferingIds: jest.fn(),
    findPublicDetailById: jest.fn(),
    hasLiked: jest.fn(),
    like: jest.fn(),
    unlike: jest.fn(),
    likeCount: jest.fn(),
  };
  const cacheInvalidation = { invalidateConsultantsCache: jest.fn() };
  const subject = new ServiceOfferingsService(
    repo,
    cacheInvalidation as unknown as ConstructorParameters<
      typeof ServiceOfferingsService
    >[1],
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAllByOwner.mockResolvedValue([]);
    repo.nextPosition.mockResolvedValue(0);
    repo.create.mockResolvedValue(service());
    repo.update.mockResolvedValue(service());
    repo.findPackagesByOfferingIds.mockResolvedValue(new Map());
    repo.replacePackages.mockResolvedValue([]);
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
     * `description` is the plain-text mirror catalog cards render and the
     * contract snapshot copies verbatim. Section bodies are editor HTML now,
     * so a card would otherwise read "<p>I set up the AWS foundation".
     */
    it('derives a plain-text description from a rich-text section body', async () => {
      repo.findById.mockResolvedValue(service());

      await subject.update('me', 'svc-1', {
        description_sections: [
          {
            layout: 'prose',
            heading: 'About this service',
            body: '<p>Terraform you can <strong>read</strong> &amp; re-run.</p><p>Handed over.</p>',
          },
        ],
      });

      expect(repo.update).toHaveBeenCalledWith(
        'svc-1',
        expect.objectContaining({
          description: 'Terraform you can read & re-run. Handed over.',
        }),
      );
    });

    /** Sections written before the rich editor are markdown, and still are. */
    it('still strips markdown from a legacy section body', async () => {
      repo.findById.mockResolvedValue(service());

      await subject.update('me', 'svc-1', {
        description_sections: [
          { layout: 'prose', body: '**Bold** intro with a `snippet`' },
        ],
      });

      expect(repo.update).toHaveBeenCalledWith(
        'svc-1',
        expect.objectContaining({ description: 'Bold intro with a snippet' }),
      );
    });

    /**
     * `service_offerings_published_needs_price` is still the real DB
     * guarantee (starting_price derives from MIN(tier price), so no packages
     * means no price). This only decides what the seller reads when they hit
     * it — a Postgres constraint name in the UI is the failure being avoided.
     */
    it('refuses to publish a package-less service, and says why', async () => {
      repo.findById.mockResolvedValue(service());
      repo.findPackagesByOfferingIds.mockResolvedValue(new Map());

      await expect(
        subject.update('me', 'svc-1', { status: 'published' }),
      ).rejects.toThrow(/at least one package before publishing/);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('publishes once at least one package exists', async () => {
      repo.findById.mockResolvedValue(service({ starting_price: 50 }));
      repo.findPackagesByOfferingIds.mockResolvedValue(
        new Map([
          [
            'svc-1',
            [
              {
                id: 'pkg-1',
                offering_id: 'svc-1',
                title: 'Starter',
                description: null,
                price: 50,
                delivery_days: 5,
                revisions: 1,
                features: [],
                position: 0,
              },
            ],
          ],
        ]),
      );

      await subject.update('me', 'svc-1', { status: 'published' });

      expect(repo.update).toHaveBeenCalled();
    });

    it('leaves the packages check out of non-publish updates', async () => {
      repo.findById.mockResolvedValue(service());

      await subject.update('me', 'svc-1', { title: 'Renamed' });

      expect(repo.findPackagesByOfferingIds).not.toHaveBeenCalled();
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

  describe('replacePackages', () => {
    it('assigns positions from array order and syncs starting_price to the minimum', async () => {
      repo.findById.mockResolvedValue(service());
      repo.replacePackages.mockResolvedValue([
        {
          id: 'p1',
          offering_id: 'svc-1',
          title: 'Full store',
          description: null,
          price: 300,
          delivery_days: 10,
          revisions: null,
          features: ['10 pages'],
          position: 0,
        },
        {
          id: 'p2',
          offering_id: 'svc-1',
          title: 'Starter',
          description: null,
          price: 80,
          delivery_days: 5,
          revisions: 2,
          features: [],
          position: 1,
        },
      ]);

      await subject.replacePackages('me', 'svc-1', {
        packages: [
          { title: 'Full store', price: 300, delivery_days: 10 },
          { title: 'Starter', price: 80, delivery_days: 5, revisions: 2 },
        ],
      });

      expect(repo.replacePackages).toHaveBeenCalledWith('svc-1', [
        expect.objectContaining({ title: 'Full store', position: 0 }),
        expect.objectContaining({
          title: 'Starter',
          position: 1,
          revisions: 2,
        }),
      ]);
      expect(repo.update).toHaveBeenCalledWith('svc-1', {
        starting_price: 80,
      });
      expect(cacheInvalidation.invalidateConsultantsCache).toHaveBeenCalledWith(
        'me',
      );
    });

    it('clearing all packages nulls the derived starting_price', async () => {
      repo.findById.mockResolvedValue(service({ starting_price: 80 }));
      repo.replacePackages.mockResolvedValue([]);

      await subject.replacePackages('me', 'svc-1', { packages: [] });

      expect(repo.update).toHaveBeenCalledWith('svc-1', {
        starting_price: null,
      });
    });

    it("refuses to write packages onto somebody else's offering", async () => {
      repo.findById.mockResolvedValue(service({ user_id: 'someone-else' }));

      await expect(
        subject.replacePackages('me', 'svc-1', { packages: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.replacePackages).not.toHaveBeenCalled();
    });
  });

  describe('likes', () => {
    it('records a like and returns the trigger-maintained count', async () => {
      repo.findById.mockResolvedValue(service({ status: 'published' }));
      repo.likeCount.mockResolvedValue(71);

      await expect(subject.setLiked('buyer', 'svc-1', true)).resolves.toEqual({
        liked: true,
        like_count: 71,
      });
      expect(repo.like).toHaveBeenCalledWith('svc-1', 'buyer');
      expect(repo.unlike).not.toHaveBeenCalled();
    });

    it('removes a like when liked is false', async () => {
      repo.findById.mockResolvedValue(service({ status: 'published' }));
      repo.likeCount.mockResolvedValue(69);

      await expect(subject.setLiked('buyer', 'svc-1', false)).resolves.toEqual({
        liked: false,
        like_count: 69,
      });
      expect(repo.unlike).toHaveBeenCalledWith('svc-1', 'buyer');
      expect(repo.like).not.toHaveBeenCalled();
    });

    /**
     * A draft is not a thing a stranger holds a reference to. The RLS policy
     * refuses it too; this keeps the API answer a 404 rather than a policy
     * error surfacing as a 400.
     */
    it('refuses to like a draft', async () => {
      repo.findById.mockResolvedValue(service({ status: 'draft' }));

      await expect(
        subject.setLiked('buyer', 'svc-1', true),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.like).not.toHaveBeenCalled();
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

/* eslint-disable @typescript-eslint/unbound-method --
 * `repo` and `taxonomy` are jest mock objects; passing their members to
 * expect() is an identity check on the mock, never a call, so `this` scoping is
 * irrelevant. Same rationale as guests.controller.spec.ts. */
import { BadRequestException } from '@nestjs/common';
import type { TaxonomyRepository } from '../taxonomy/repositories/taxonomy.repository.interface';
import type { SurveyRepository } from './repositories/survey.repository.interface';
import { SurveyService } from './survey.service';
import type { MarketplaceSurvey } from './survey.types';

function survey(over: Partial<MarketplaceSurvey> = {}): MarketplaceSurvey {
  return {
    status: 'in_progress',
    intents: [],
    categories: [],
    talent_goal: null,
    company_size: null,
    completed_at: null,
    updated_at: '2026-08-19T00:00:00Z',
    ...over,
  };
}

describe('SurveyService', () => {
  const repo: jest.Mocked<SurveyRepository> = {
    findByUser: jest.fn(),
    upsert: jest.fn(),
    markSkipped: jest.fn(),
    findCategories: jest.fn(),
    replaceCategories: jest.fn(),
  };
  const taxonomy = {
    findCategoryIdsBySlugs: jest.fn(),
  } as unknown as jest.Mocked<TaxonomyRepository>;

  const subject = new SurveyService(repo, taxonomy);

  beforeEach(() => {
    jest.clearAllMocks();
    repo.upsert.mockResolvedValue(survey());
    repo.markSkipped.mockResolvedValue(survey({ status: 'skipped' }));
    repo.findCategories.mockResolvedValue([]);
    repo.replaceCategories.mockResolvedValue([]);
    taxonomy.findCategoryIdsBySlugs.mockResolvedValue(
      new Map([
        ['ai-and-data', 'cat-ai'],
        ['design-and-brand', 'cat-design'],
      ]),
    );
  });

  describe('findMine', () => {
    it('returns null when the user has never been asked, which is what opens the modal', async () => {
      repo.findByUser.mockResolvedValue(null);
      await expect(subject.findMine('me')).resolves.toBeNull();
      expect(repo.findCategories).not.toHaveBeenCalled();
    });

    it('attaches the chosen categories to the stored row', async () => {
      repo.findByUser.mockResolvedValue(survey({ intents: ['client'] }));
      repo.findCategories.mockResolvedValue([
        { slug: 'ai-and-data', name: 'AI & Data' },
      ]);

      await expect(subject.findMine('me')).resolves.toMatchObject({
        intents: ['client'],
        categories: [{ slug: 'ai-and-data', name: 'AI & Data' }],
      });
    });
  });

  describe('save', () => {
    it('de-duplicates intents, which no CHECK constraint can do', async () => {
      await subject.save('me', { intents: ['client', 'client', 'talent'] });

      expect(repo.upsert).toHaveBeenCalledWith(
        'me',
        expect.objectContaining({ intents: ['client', 'talent'] }),
      );
    });

    it('de-duplicates category slugs before resolving them', async () => {
      await subject.save('me', {
        intents: ['client'],
        category_slugs: ['ai-and-data', 'ai-and-data'],
      });

      expect(taxonomy.findCategoryIdsBySlugs).toHaveBeenCalledWith([
        'ai-and-data',
      ]);
      expect(repo.replaceCategories).toHaveBeenCalledWith('me', ['cat-ai']);
    });

    it('preserves the order the user picked, because the first is what the storefront leads with', async () => {
      await subject.save('me', {
        intents: ['client'],
        category_slugs: ['design-and-brand', 'ai-and-data'],
      });

      expect(repo.replaceCategories).toHaveBeenCalledWith('me', [
        'cat-design',
        'cat-ai',
      ]);
    });

    it('rejects an unknown category slug by name instead of dropping it', async () => {
      await expect(
        subject.save('me', {
          intents: ['client'],
          category_slugs: ['ai-and-data', 'underwater-basket-weaving'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes nothing when a slug fails to resolve, so the row cannot be half-applied', async () => {
      await expect(
        subject.save('me', {
          intents: ['client'],
          category_slugs: ['nope'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.upsert).not.toHaveBeenCalled();
      expect(repo.replaceCategories).not.toHaveBeenCalled();
    });

    it('refuses to complete a survey with no intent, in words rather than a constraint name', async () => {
      await expect(
        subject.save('me', { intents: [], status: 'completed' }),
      ).rejects.toThrow(/at least one option/i);
    });

    it('sets completed_at only when completing, which the status CHECK requires', async () => {
      await subject.save('me', { intents: ['client'], status: 'completed' });
      expect(repo.upsert).toHaveBeenCalledWith(
        'me',
        expect.objectContaining({
          status: 'completed',
          completed_at: expect.any(String),
        }),
      );

      jest.clearAllMocks();
      repo.upsert.mockResolvedValue(survey());
      repo.replaceCategories.mockResolvedValue([]);

      await subject.save('me', { intents: ['client'] });
      expect(repo.upsert).toHaveBeenCalledWith(
        'me',
        expect.objectContaining({ status: 'in_progress', completed_at: null }),
      );
    });

    it('clears categories when the step is skipped, rather than leaving stale picks', async () => {
      await subject.save('me', { intents: ['client'] });
      expect(repo.replaceCategories).toHaveBeenCalledWith('me', []);
      expect(taxonomy.findCategoryIdsBySlugs).not.toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('is idempotent, because the client fires it on dismissal and may retry', async () => {
      await expect(subject.skip('me')).resolves.toMatchObject({
        status: 'skipped',
      });
      await expect(subject.skip('me')).resolves.toMatchObject({
        status: 'skipped',
      });
      expect(repo.markSkipped).toHaveBeenCalledTimes(2);
    });
  });
});

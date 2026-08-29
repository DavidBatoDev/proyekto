/* eslint-disable @typescript-eslint/unbound-method --
 * `repo` is a jest mock object; passing its members to expect() is an
 * identity check on the mock, never a call, so `this` scoping is
 * irrelevant. Same rationale as consultant-services.service.spec.ts. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { missingPublishFields, PostingsService } from './postings.service';
import type { PostingProposal, ProjectPosting } from './postings.types';
import type { PostingsRepository } from './repositories/postings.repository.interface';

const consultantCapability = jest.fn();
jest.mock('../../../common/auth/consultant-capability', () => ({
  isActiveConsultantEnrollment: (...args: unknown[]) =>
    consultantCapability(...args) as Promise<boolean>,
}));

function posting(over: Partial<ProjectPosting> = {}): ProjectPosting {
  return {
    id: 'posting-1',
    author_id: 'author',
    title: 'Event supplier marketplace',
    engagement_type: 'one_time',
    summary: '<p>Build a marketplace</p>',
    sections: [],
    category_id: 'cat-1',
    subcategory_id: null,
    budget_min: 5000,
    budget_max: 12000,
    currency: 'USD',
    duration: '3-6_months',
    duration_custom: null,
    roadmap_id: null,
    status: 'draft',
    published_at: null,
    closed_at: null,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...over,
  };
}

function proposal(over: Partial<PostingProposal> = {}): PostingProposal {
  return {
    id: 'proposal-1',
    posting_id: 'posting-1',
    consultant_id: 'consultant',
    pitch: 'I have shipped three marketplaces like this one',
    indicative_rate: 9000,
    rate_currency: 'USD',
    rate_unit: 'project',
    status: 'submitted',
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...over,
  };
}

describe('PostingsService', () => {
  const repo: jest.Mocked<PostingsRepository> = {
    findById: jest.fn(),
    findAllByAuthor: jest.fn(),
    findBoard: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findAttachments: jest.fn(),
    addAttachment: jest.fn(),
    removeAttachment: jest.fn(),
    findRoadmapSummary: jest.fn(),
    findProposalById: jest.fn(),
    findProposalsForPosting: jest.fn(),
    findProposalByConsultant: jest.fn(),
    findProposalsByConsultant: jest.fn(),
    countProposals: jest.fn(),
    upsertProposal: jest.fn(),
    setProposalStatus: jest.fn(),
    findAuthorSummaries: jest.fn(),
  };

  const subject = new PostingsService(repo, {} as SupabaseClient);

  beforeEach(() => {
    jest.clearAllMocks();
    consultantCapability.mockResolvedValue(false);
    repo.findAllByAuthor.mockResolvedValue([]);
    repo.findAttachments.mockResolvedValue([]);
    repo.countProposals.mockResolvedValue(new Map());
    repo.findAuthorSummaries.mockResolvedValue(new Map());
    repo.findProposalByConsultant.mockResolvedValue(null);
    repo.update.mockResolvedValue(posting());
  });

  describe('missingPublishFields', () => {
    it('names every structured field the board filters on', () => {
      expect(
        missingPublishFields(
          posting({
            summary: null,
            budget_min: null,
            budget_max: null,
            duration: null,
            category_id: null,
          }),
        ),
      ).toEqual(['Overview', 'Budget', 'Timeline', 'Category']);
    });

    it('treats an empty rich-text summary as absent', () => {
      // The editor emits "<p></p>" for a paragraph the author cleared, which is
      // a non-empty string and would otherwise pass.
      expect(missingPublishFields(posting({ summary: '<p></p>' }))).toEqual([
        'Overview',
      ]);
    });

    it('accepts a brief carrying only one end of the budget range', () => {
      expect(missingPublishFields(posting({ budget_min: null }))).toEqual([]);
    });

    it('does not demand any particular prose section', () => {
      expect(missingPublishFields(posting({ sections: [] }))).toEqual([]);
    });

    it('accepts a timeline written in the author’s own words', () => {
      expect(
        missingPublishFields(
          posting({ duration: 'custom', duration_custom: 'about ten weeks' }),
        ),
      ).toEqual([]);
    });

    it('treats "Something else" with nothing typed as no timeline at all', () => {
      expect(
        missingPublishFields(
          posting({ duration: 'custom', duration_custom: null }),
        ),
      ).toEqual(['Timeline']);
      expect(
        missingPublishFields(
          posting({ duration: 'custom', duration_custom: '   ' }),
        ),
      ).toEqual(['Timeline']);
    });
  });

  describe('publish', () => {
    it('refuses an incomplete brief and says what is missing', async () => {
      repo.findById.mockResolvedValue(posting({ duration: null }));

      await expect(subject.publish('author', 'posting-1')).rejects.toThrow(
        /Timeline/,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('stamps published_at and clears any earlier close', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'closed' }));

      await subject.publish('author', 'posting-1');

      expect(repo.update).toHaveBeenCalledWith(
        'posting-1',
        expect.objectContaining({ status: 'published', closed_at: null }),
      );
    });
  });

  describe('getDetail', () => {
    it('hides a draft from a verified consultant as 404, not 403', async () => {
      // 403 would confirm the id exists, which is exactly what a scraper wants.
      repo.findById.mockResolvedValue(posting({ status: 'draft' }));
      consultantCapability.mockResolvedValue(true);

      await expect(
        subject.getDetail('consultant', 'posting-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides a published brief from a non-consultant', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'published' }));
      consultantCapability.mockResolvedValue(false);

      await expect(
        subject.getDetail('stranger', 'posting-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows the author their own draft', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'draft' }));

      const detail = await subject.getDetail('author', 'posting-1');

      expect(detail.id).toBe('posting-1');
      // The author is not asked to be a consultant to read their own brief.
      expect(consultantCapability).not.toHaveBeenCalled();
    });

    it("attaches the consultant their own proposal but never somebody else's", async () => {
      repo.findById.mockResolvedValue(posting({ status: 'published' }));
      consultantCapability.mockResolvedValue(true);
      repo.findProposalByConsultant.mockResolvedValue(proposal());

      const detail = await subject.getDetail('consultant', 'posting-1');

      expect(repo.findProposalByConsultant).toHaveBeenCalledWith(
        'posting-1',
        'consultant',
      );
      expect(detail.my_proposal?.id).toBe('proposal-1');
    });
  });

  describe('submitProposal', () => {
    const dto = { pitch: 'I have shipped three marketplaces like this one' };

    it('refuses a draft brief as 404', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'draft' }));

      await expect(
        subject.submitProposal('consultant', 'posting-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stops an author applying to their own brief', async () => {
      repo.findById.mockResolvedValue(posting({ status: 'published' }));

      await expect(
        subject.submitProposal('author', 'posting-1', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("defaults the rate currency to the brief's own currency", async () => {
      repo.findById.mockResolvedValue(
        posting({ status: 'published', currency: 'PHP' }),
      );
      repo.upsertProposal.mockResolvedValue(proposal());

      await subject.submitProposal('consultant', 'posting-1', dto);

      expect(repo.upsertProposal).toHaveBeenCalledWith(
        expect.objectContaining({ rate_currency: 'PHP' }),
      );
    });
  });

  describe('triageProposal', () => {
    it("refuses somebody else's brief", async () => {
      repo.findProposalById.mockResolvedValue(proposal());
      repo.findById.mockResolvedValue(posting({ author_id: 'somebody-else' }));

      await expect(
        subject.triageProposal('author', 'proposal-1', {
          status: 'shortlisted',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('will not re-triage a withdrawn proposal', async () => {
      repo.findProposalById.mockResolvedValue(
        proposal({ status: 'withdrawn' }),
      );
      repo.findById.mockResolvedValue(posting());

      await expect(
        subject.triageProposal('author', 'proposal-1', {
          status: 'shortlisted',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('withdrawProposal', () => {
    it("will not let one consultant withdraw another's proposal", async () => {
      repo.findProposalById.mockResolvedValue(
        proposal({ consultant_id: 'someone-else' }),
      );

      await expect(
        subject.withdrawProposal('consultant', 'proposal-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.setProposalStatus).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('compacts section positions so a deleted section leaves no gap', async () => {
      repo.create.mockResolvedValue(posting());

      await subject.create('author', {
        title: 'A brief',
        sections: [
          { key: 'Scope', value: 'b', position: 7 },
          { key: 'Overview', value: 'a', position: 2 },
        ],
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [
            { key: 'Overview', value: 'a', position: 0 },
            { key: 'Scope', value: 'b', position: 1 },
          ],
        }),
      );
    });

    it('keeps a free-text timeline only beside the option that asks for it', async () => {
      repo.create.mockResolvedValue(posting());

      await subject.create('author', {
        title: 'A brief',
        duration: 'custom',
        duration_custom: '  about ten weeks  ',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 'custom',
          duration_custom: 'about ten weeks',
        }),
      );

      await subject.create('author', {
        title: 'A brief',
        duration: '1-3_months',
        duration_custom: 'about ten weeks',
      });
      expect(repo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          duration: '1-3_months',
          duration_custom: null,
        }),
      );
    });
  });

  describe('update', () => {
    it('clears the custom timeline when the author picks a bucket instead', async () => {
      repo.findById.mockResolvedValue(
        posting({ duration: 'custom', duration_custom: 'about ten weeks' }),
      );
      repo.update.mockResolvedValue(posting());

      await subject.update('author', 'posting-1', {
        title: 'Event supplier marketplace',
        duration: '2-4_weeks',
      });

      expect(repo.update).toHaveBeenCalledWith(
        'posting-1',
        expect.objectContaining({
          duration: '2-4_weeks',
          duration_custom: null,
        }),
      );
    });

    it('leaves the timeline alone when the patch does not mention it', async () => {
      repo.findById.mockResolvedValue(
        posting({ duration: 'custom', duration_custom: 'about ten weeks' }),
      );
      repo.update.mockResolvedValue(posting());

      await subject.update('author', 'posting-1', { title: 'Renamed brief' });

      const patch = repo.update.mock.calls[0][1];
      expect(patch).not.toHaveProperty('duration');
      expect(patch).not.toHaveProperty('duration_custom');
    });
  });
});

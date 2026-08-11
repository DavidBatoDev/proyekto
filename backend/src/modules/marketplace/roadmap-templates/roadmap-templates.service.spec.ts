import { BadRequestException } from '@nestjs/common';
import { RoadmapTemplatesService } from './roadmap-templates.service';

describe('RoadmapTemplatesService', () => {
  const maybeSingle = jest.fn();
  const single = jest.fn();
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    update: jest.fn(),
    maybeSingle,
    single,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.update.mockReturnValue(query);
  const db = { rpc: jest.fn(), from: jest.fn(() => query) };
  const cache = {};
  const cacheInvalidation = {
    invalidateDashboardCacheForUser: jest.fn().mockResolvedValue(undefined),
    invalidateRoadmapTemplatesCache: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RoadmapTemplatesService(
    db as unknown as ConstructorParameters<typeof RoadmapTemplatesService>[0],
    cache as unknown as ConstructorParameters<
      typeof RoadmapTemplatesService
    >[1],
    cacheInvalidation as unknown as ConstructorParameters<
      typeof RoadmapTemplatesService
    >[2],
  );
  const validateSnapshot = (content: unknown) =>
    (
      service as unknown as {
        validateSnapshot(value: unknown): void;
      }
    ).validateSnapshot(content);

  const validContent = () => ({
    contract_version: 1,
    schedule_kind: 'long_term',
    roadmap: {
      name: 'Launch plan',
      description: 'A safe roadmap snapshot',
      schedule_kind: 'long_term',
      start_day_offset: 0,
      end_day_offset: 119,
    },
    milestones: Array.from({ length: 4 }, (_, epicIndex) => ({
      key: `milestone-${epicIndex + 1}`,
      title: `Month ${epicIndex + 1} approved`,
      time_label: `(End of Month ${epicIndex + 1})`,
      target_day_offset: epicIndex * 30 + 29,
      feature_keys: Array.from(
        { length: 3 },
        (_, featureIndex) => `feature-${epicIndex + 1}-${featureIndex + 1}`,
      ),
    })),
    epics: Array.from({ length: 4 }, (_, epicIndex) => ({
      key: `epic-${epicIndex + 1}`,
      title: `Delivery phase ${epicIndex + 1}`,
      time_label: `(Month ${epicIndex + 1})`,
      start_day_offset: epicIndex * 30,
      end_day_offset: epicIndex * 30 + 29,
      priority: 'high',
      tags: [],
      features: Array.from({ length: 3 }, (_, featureIndex) => {
        const start = epicIndex * 30 + featureIndex * 10;
        return {
          key: `feature-${epicIndex + 1}-${featureIndex + 1}`,
          title: `Outcome ${featureIndex + 1}`,
          time_label: `(Week ${epicIndex * 4 + featureIndex + 1})`,
          start_day_offset: start,
          end_day_offset: start + 9,
          is_deliverable: true,
          tasks: Array.from({ length: 2 }, (_, taskIndex) => ({
            key: `task-${epicIndex + 1}-${featureIndex + 1}-${taskIndex + 1}`,
            title: `Complete action ${taskIndex + 1}`,
            priority: 'high',
            position: taskIndex,
            work_type: 'real_work',
            due_day_offset: start + taskIndex,
            checklist: [],
          })),
        };
      }),
    })),
  });

  beforeEach(() => jest.clearAllMocks());

  it('calls the service-only transactional RPC with idempotency and schedule inputs', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: 'template-1', slug: 'saas-mvp-launch' },
      error: null,
    });
    db.rpc.mockResolvedValueOnce({
      data: {
        roadmap_id: 'roadmap-1',
        project_id: null,
        idempotent_replay: false,
      },
      error: null,
    });

    await expect(
      service.instantiate('template-1', 'user-1', {
        start_date: '2026-07-14',
        idempotency_key: '10000000-0000-4000-8000-000000000001',
        source_surface: 'marketplace',
      }),
    ).resolves.toEqual(expect.objectContaining({ roadmap_id: 'roadmap-1' }));

    expect(db.rpc).toHaveBeenCalledWith(
      'instantiate_roadmap_public_template',
      expect.objectContaining({
        p_template_id: 'template-1',
        p_template_version_id: null,
        p_user_id: 'user-1',
        p_project_id: null,
        p_start_date: '2026-07-14',
        p_source_surface: 'marketplace',
      }),
    );
    expect(
      cacheInvalidation.invalidateDashboardCacheForUser,
    ).toHaveBeenCalledWith('user-1');
    expect(
      cacheInvalidation.invalidateRoadmapTemplatesCache,
    ).toHaveBeenCalledWith('saas-mvp-launch');
  });

  it('accepts a sanitized complete snapshot', () => {
    expect(() => validateSnapshot(validContent())).not.toThrow();
  });

  it('uses compact generated previews for catalog reads and full content only for details', () => {
    const selectors = service as unknown as {
      publicSummarySelect(): string;
      publicDetailSelect(): string;
    };

    expect(selectors.publicSummarySelect()).toContain(
      'current_version:roadmap_template_versions',
    );
    expect(selectors.publicSummarySelect()).toContain('version_number,preview');
    expect(selectors.publicSummarySelect()).not.toContain('preview,content');
    expect(selectors.publicDetailSelect()).toContain('preview,content');
  });

  it('maps the stored preview without exposing task snapshot payloads', () => {
    const compactPreview = {
      epics: [
        {
          id: 'epic-1',
          title: '(Month 1) Product foundation',
          position: 0,
          features: [
            { id: 'feature-1', title: '(Week 1) Validate the problem' },
          ],
        },
      ],
      milestone_count: 4,
    };
    const mapper = service as unknown as {
      toSummary(row: Record<string, unknown>): { preview: unknown };
    };
    const row = {
      id: 'template-1',
      slug: 'saas-mvp-launch',
      title: 'SaaS MVP Launch',
      summary: 'Launch a focused SaaS product.',
      preview_url: '',
      category: { slug: 'saas', name: 'SaaS' },
      template_tags: [],
      difficulty: 'intermediate',
      schedule_kind: 'long_term',
      estimated_duration_days: 120,
      attribution_name: 'Proyekto',
      attribution_url: null,
      is_featured: true,
      published_at: '2026-07-15T00:00:00.000Z',
      view_count: 0,
      use_count: 0,
      duplicate_count: 0,
      rating_count: 0,
      rating_average: 0,
    };
    const summary = mapper.toSummary({
      ...row,
      current_version: {
        id: 'version-1',
        version_number: 1,
        preview: compactPreview,
      },
    });

    expect(summary.preview).toEqual(compactPreview);
    expect(JSON.stringify(summary.preview)).not.toContain('tasks');
    expect(JSON.stringify(summary.preview)).not.toContain('checklist');

    const legacySummary = mapper.toSummary({
      ...row,
      current_version: {
        id: 'version-1',
        version_number: 1,
        content: validContent(),
      },
    });
    expect(JSON.stringify(legacySummary.preview)).not.toContain('tasks');
    expect(JSON.stringify(legacySummary.preview)).not.toContain('checklist');
  });

  it('rejects personal/runtime fields and unsafe markup', () => {
    const personal = structuredClone(validContent()) as unknown as {
      epics: Array<{
        features: Array<{ tasks: Array<Record<string, unknown>> }>;
      }>;
    };
    personal.epics[0].features[0].tasks[0].assignee = 'user-1';
    expect(() => validateSnapshot(personal)).toThrow(BadRequestException);

    const unsafe = structuredClone(validContent()) as unknown as {
      epics: Array<{ description?: string }>;
    };
    unsafe.epics[0].description = '<script>alert(1)</script>';
    expect(() => validateSnapshot(unsafe)).toThrow('unsafe content');
  });

  it('rejects broken milestone-to-feature references', () => {
    const content = structuredClone(validContent()) as unknown as {
      milestones: Array<{ feature_keys: string[] }>;
    };
    content.milestones[0].feature_keys = ['missing-feature'];
    expect(() => validateSnapshot(content)).toThrow('unknown feature');
  });

  it('rejects incomplete hierarchy counts', () => {
    const content = validContent();
    content.epics[0].features[0].tasks.pop();

    expect(() => validateSnapshot(content)).toThrow(
      'between 2 and 4 actionable tasks',
    );
  });

  it('invalidates public caches when featured status changes', async () => {
    single.mockResolvedValueOnce({
      data: { id: 'template-1', slug: 'saas-mvp-launch', is_featured: true },
      error: null,
    });

    await expect(service.setFeatured('template-1', true)).resolves.toEqual(
      expect.objectContaining({ is_featured: true }),
    );
    expect(query.update).toHaveBeenCalledWith({ is_featured: true });
    expect(
      cacheInvalidation.invalidateRoadmapTemplatesCache,
    ).toHaveBeenCalledWith('saas-mvp-launch');
  });
});

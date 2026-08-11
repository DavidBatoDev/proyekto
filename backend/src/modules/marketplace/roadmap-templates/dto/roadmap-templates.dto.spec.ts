import 'reflect-metadata';
import { validateSync } from 'class-validator';
import {
  InstantiateRoadmapTemplateDto,
  RoadmapTemplateCatalogQueryDto,
} from './roadmap-templates.dto';

describe('roadmap template DTO validation', () => {
  it('accepts supported string choices', () => {
    const catalog = Object.assign(new RoadmapTemplateCatalogQueryDto(), {
      difficulty: 'beginner',
      schedule_kind: 'short_learning',
      sort: 'popular',
    });
    const instantiate = Object.assign(new InstantiateRoadmapTemplateDto(), {
      start_date: '2026-07-14',
      idempotency_key: '10000000-0000-4000-8000-000000000001',
      source_surface: 'roadmap_create',
    });

    expect(validateSync(catalog)).toHaveLength(0);
    expect(validateSync(instantiate)).toHaveLength(0);
  });

  it('rejects unsupported string choices', () => {
    const dto = Object.assign(new InstantiateRoadmapTemplateDto(), {
      start_date: '2026-07-14',
      idempotency_key: '10000000-0000-4000-8000-000000000001',
      source_surface: 'paid_checkout',
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });
});

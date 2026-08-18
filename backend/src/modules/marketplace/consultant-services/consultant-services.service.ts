import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import {
  CONSULTANT_SERVICES_REPOSITORY,
  type ConsultantServicesRepository,
} from './repositories/consultant-services.repository.interface';
import type { ConsultantService } from './consultant-services.types';
import type {
  CreateConsultantServiceDto,
  ReorderConsultantServicesDto,
  UpdateConsultantServiceDto,
} from './dto/consultant-services.dto';

/** Matches the DB cap so the user sees a sentence, not a constraint name. */
const MAX_SERVICES_PER_CONSULTANT = 40;

@Injectable()
export class ConsultantServicesService {
  constructor(
    @Inject(CONSULTANT_SERVICES_REPOSITORY)
    private readonly repo: ConsultantServicesRepository,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  listMine(userId: string): Promise<ConsultantService[]> {
    return this.repo.findAllByOwner(userId);
  }

  async create(
    userId: string,
    dto: CreateConsultantServiceDto,
  ): Promise<ConsultantService> {
    const existing = await this.repo.findAllByOwner(userId);
    if (existing.length >= MAX_SERVICES_PER_CONSULTANT) {
      throw new BadRequestException(
        `You can hold up to ${MAX_SERVICES_PER_CONSULTANT} services. Archive one to add another.`,
      );
    }

    const service = await this.repo.create({
      user_id: userId,
      title: dto.title,
      description: dto.description ?? null,
      subcategory_id: dto.subcategory_id ?? null,
      cover_url: dto.cover_url ?? null,
      starting_price: dto.starting_price ?? null,
      currency: dto.currency ?? 'USD',
      price_unit: dto.price_unit ?? 'project',
      delivery_days: dto.delivery_days ?? null,
      position: await this.repo.nextPosition(userId),
    });

    await this.invalidate(userId);
    return service;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateConsultantServiceDto,
  ): Promise<ConsultantService> {
    const existing = await this.assertOwned(userId, id);

    // Checked here as well as in the DB so the consultant reads a sentence
    // instead of `consultant_services_published_needs_price`. The constraint
    // stays as the real guarantee — this is only the wording.
    const nextPrice =
      dto.starting_price !== undefined
        ? dto.starting_price
        : existing.starting_price;
    if (dto.status === 'published' && nextPrice === null) {
      throw new BadRequestException(
        'Set a starting price before publishing this service.',
      );
    }

    const service = await this.repo.update(id, {
      ...dto,
      description: dto.description ?? undefined,
    });
    await this.invalidate(userId);
    return service;
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    await this.repo.remove(id);
    await this.invalidate(userId);
  }

  async reorder(
    userId: string,
    dto: ReorderConsultantServicesDto,
  ): Promise<ConsultantService[]> {
    // Ownership is re-checked per row inside the repository's `.eq('user_id')`,
    // so a foreign id in the payload silently updates nothing rather than
    // moving somebody else's service.
    await this.repo.reorder(userId, dto.items);
    await this.invalidate(userId);
    return this.repo.findAllByOwner(userId);
  }

  private async assertOwned(
    userId: string,
    id: string,
  ): Promise<ConsultantService> {
    const service = await this.repo.findById(id);
    if (!service) throw new NotFoundException('Service not found');
    if (service.user_id !== userId) {
      throw new ForbiddenException('This service belongs to someone else');
    }
    return service;
  }

  /**
   * The public consultant profile is cached and now carries the service
   * catalog, so every write here has to purge it or a published service stays
   * invisible for a full TTL.
   */
  private async invalidate(userId: string): Promise<void> {
    await this.cacheInvalidation.invalidateConsultantsCache(userId);
  }
}

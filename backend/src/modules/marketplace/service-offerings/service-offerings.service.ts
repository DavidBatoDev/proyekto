import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import {
  SERVICE_OFFERINGS_REPOSITORY,
  type ServiceOfferingsRepository,
} from './repositories/service-offerings.repository.interface';
import type {
  PublicServiceOfferingDetail,
  ServiceOffering,
} from './service-offerings.types';
import type {
  CreateServiceOfferingDto,
  ReorderServiceOfferingsDto,
  ReplaceOfferingPackagesDto,
  ServiceDescriptionSectionDto,
  UpdateServiceOfferingDto,
} from './dto/service-offerings.dto';

/** Matches the DB cap so the user sees a sentence, not a constraint name. */
const MAX_OFFERINGS_PER_SELLER = 40;

/**
 * The plain-text blurb catalog cards and the contract snapshot read, derived
 * from the first section so sellers only ever edit the sections themselves.
 *
 * Bodies arrive in either format: HTML from the rich-text editor, or markdown
 * for every section written before it. Both are reduced to text rather than
 * escaped — a card showing `<p>` or `**bold**` looks broken, and the authored
 * version still lives in the sections. Capped at 1000 to match
 * ContractServiceDto, which copies this verbatim.
 */
function summarise(
  sections: ServiceDescriptionSectionDto[] | undefined,
): string | null | undefined {
  if (sections === undefined) return undefined;
  const first = sections[0];
  const raw =
    first?.layout === 'columns'
      ? (first.columns ?? [])
          .map((column) => `${column.label}: ${column.body}`)
          .join('. ')
      : (first?.body ?? '');
  const plain = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Block ends become a space, or the last word of one paragraph would run
    // into the first word of the next.
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^[>#\-*+\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return plain.length > 1000 ? `${plain.slice(0, 997)}...` : plain;
}

@Injectable()
export class ServiceOfferingsService {
  constructor(
    @Inject(SERVICE_OFFERINGS_REPOSITORY)
    private readonly repo: ServiceOfferingsRepository,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async listMine(userId: string): Promise<ServiceOffering[]> {
    const offerings = await this.repo.findAllByOwner(userId);
    return this.withPackages(offerings);
  }

  /** Published offerings for a public profile strip (talent or consultant). */
  async listPublishedByUser(userId: string): Promise<ServiceOffering[]> {
    const offerings = await this.repo.findPublishedByOwner(userId);
    return this.withPackages(offerings);
  }

  /** The service detail page. Null → controller 404s. */
  async getPublicById(id: string): Promise<PublicServiceOfferingDetail> {
    const detail = await this.repo.findPublicDetailById(id);
    if (!detail) throw new NotFoundException('Service not found');
    return detail;
  }

  async replacePackages(
    userId: string,
    id: string,
    dto: ReplaceOfferingPackagesDto,
  ): Promise<ServiceOffering> {
    await this.assertOwned(userId, id);

    const rows = dto.packages.map((pkg, index) => ({
      title: pkg.title,
      description: pkg.description ?? null,
      price: pkg.price,
      delivery_days: pkg.delivery_days ?? null,
      revisions: pkg.revisions ?? null,
      features: pkg.features ?? [],
      position: index,
    }));

    const packages = await this.repo.replacePackages(id, rows);

    // The parent's starting_price is derived, not authored: MIN(tier price)
    // keeps the published_needs_price CHECK and the directory's "From $X"
    // working without the seller maintaining two numbers.
    const minPrice = packages.length
      ? Math.min(...packages.map((pkg) => pkg.price))
      : null;
    const updated = await this.repo.update(id, {
      starting_price: minPrice,
    });

    await this.invalidate(userId);
    return { ...updated, packages };
  }

  private async withPackages(
    offerings: ServiceOffering[],
  ): Promise<ServiceOffering[]> {
    const packagesByOffering = await this.repo.findPackagesByOfferingIds(
      offerings.map((offering) => offering.id),
    );
    return offerings.map((offering) => ({
      ...offering,
      packages: packagesByOffering.get(offering.id) ?? [],
    }));
  }

  async create(
    userId: string,
    dto: CreateServiceOfferingDto,
  ): Promise<ServiceOffering> {
    const existing = await this.repo.findAllByOwner(userId);
    if (existing.length >= MAX_OFFERINGS_PER_SELLER) {
      throw new BadRequestException(
        `You can hold up to ${MAX_OFFERINGS_PER_SELLER} services. Archive one to add another.`,
      );
    }

    const service = await this.repo.create({
      user_id: userId,
      title: dto.title,
      description:
        summarise(dto.description_sections) ?? dto.description ?? null,
      description_sections: dto.description_sections ?? [],
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
    dto: UpdateServiceOfferingDto,
  ): Promise<ServiceOffering> {
    const existing = await this.assertOwned(userId, id);

    // Publishing needs at least one priced tier. Checked here so the seller
    // reads a sentence instead of `service_offerings_published_needs_price`
    // (starting_price is derived from MIN(tier price), so package-less means
    // price-less); the DB constraint stays as the real guarantee.
    if (dto.status === 'published') {
      const packagesByOffering = await this.repo.findPackagesByOfferingIds([
        id,
      ]);
      if ((packagesByOffering.get(id) ?? []).length === 0) {
        throw new BadRequestException(
          'Add at least one package before publishing this service.',
        );
      }
    }

    // Sections are the source of truth for the About area; `description`
    // follows them so nothing reading the old field goes stale.
    const derived = summarise(dto.description_sections);
    const service = await this.repo.update(id, {
      ...dto,
      description: derived ?? dto.description ?? undefined,
    });
    await this.invalidate(userId);
    return service;
  }

  /**
   * Likes are the buyer-side save. Published-only: a draft is not something
   * a stranger can hold a reference to, and the RLS policy says the same, so
   * a draft like fails in both places rather than only one.
   */
  async setLiked(
    userId: string,
    id: string,
    liked: boolean,
  ): Promise<{ liked: boolean; like_count: number }> {
    const offering = await this.repo.findById(id);
    if (!offering || offering.status !== 'published') {
      throw new NotFoundException('Service not found.');
    }

    if (liked) {
      await this.repo.like(id, userId);
    } else {
      await this.repo.unlike(id, userId);
    }

    return { liked, like_count: await this.repo.likeCount(id) };
  }

  async getLiked(
    userId: string,
    id: string,
  ): Promise<{ liked: boolean; like_count: number }> {
    const [liked, like_count] = await Promise.all([
      this.repo.hasLiked(id, userId),
      this.repo.likeCount(id),
    ]);
    return { liked, like_count };
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    await this.repo.remove(id);
    await this.invalidate(userId);
  }

  async reorder(
    userId: string,
    dto: ReorderServiceOfferingsDto,
  ): Promise<ServiceOffering[]> {
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
  ): Promise<ServiceOffering> {
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

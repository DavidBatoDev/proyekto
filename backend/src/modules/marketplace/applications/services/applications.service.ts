import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsultantApplication } from '../../../../common/entities';
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import { CreateApplicationDto } from '../dto/application.dto';
import {
  APPLICATIONS_REPOSITORY,
  ApplicationsRepository,
} from '../repositories/applications.repository.interface';
import {
  ConsultantEligibility,
  ConsultantEligibilityService,
} from './consultant-eligibility.service';

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly appRepo: ApplicationsRepository,
    private readonly eligibility: ConsultantEligibilityService,
    private readonly notifications: NotificationsService,
  ) {}

  async getMyApplication(
    userId: string,
  ): Promise<ConsultantApplication | null> {
    return this.appRepo.findByUser(userId);
  }

  async getEligibility(userId: string): Promise<ConsultantEligibility> {
    return this.eligibility.check(userId);
  }

  async upsert(
    userId: string,
    dto: CreateApplicationDto,
  ): Promise<ConsultantApplication> {
    const existing = await this.appRepo.findByUser(userId);
    if (existing && !this.isEditable(existing.status)) {
      throw new BadRequestException(
        `Application is '${existing.status}' and can no longer be edited.`,
      );
    }

    return this.appRepo.upsert(userId, {
      linkedin_url: dto.linkedin_url,
      placements: this.placementsFromDto(dto),
    });
  }

  async submit(userId: string): Promise<ConsultantApplication> {
    const existing = await this.appRepo.findByUser(userId);
    if (!existing) {
      throw new NotFoundException('No application found. Create one first.');
    }
    if (!this.isSubmittable(existing.status)) {
      throw new BadRequestException(
        `Application is already in '${existing.status}' state and cannot be re-submitted`,
      );
    }

    const { eligible, missing } = await this.eligibility.check(userId);
    if (!eligible) {
      // Same {message, missing} shape the talent go-live endpoint throws, so
      // the web wizard's readError()/checklist handling works unchanged.
      throw new BadRequestException({
        message: 'Complete your application before submitting.',
        missing,
      });
    }

    const submitted = await this.appRepo.submit(userId);
    await this.notifyAdmins(userId, submitted.id);
    return submitted;
  }

  /**
   * Tell active admins an application is waiting. Best-effort: the submission
   * itself is the durable record, and a notification failure must not turn a
   * successful submit into a 500 (same contract as admin.service's emitter).
   */
  private async notifyAdmins(
    applicantId: string,
    applicationId: string,
  ): Promise<void> {
    try {
      const adminIds = await this.appRepo.listActiveAdminUserIds();
      await Promise.all(
        adminIds
          .filter((adminId) => adminId !== applicantId)
          .map((adminId) =>
            this.notifications.createNotification({
              user_id: adminId,
              type_name: 'consultant_application_submitted',
              actor_id: applicantId,
              content: {
                message: 'A consultant application is waiting for review.',
                application_id: applicationId,
              },
              link_url: '/admin/applications',
            }),
          ),
      );
    } catch {
      // Swallowed on purpose — see docblock.
    }
  }

  private isEditable(status: ConsultantApplication['status']): boolean {
    return status === 'draft' || status === 'rejected';
  }

  private isSubmittable(status: ConsultantApplication['status']): boolean {
    return status === 'draft' || status === 'rejected';
  }

  private placementsFromDto(dto: CreateApplicationDto):
    | Array<{
        subcategory_id: string;
        years_experience: number | null;
        is_primary: boolean;
        position: number;
      }>
    | undefined {
    if (dto.placements === undefined) return undefined;

    // First occurrence wins on duplicates, keeping its years value.
    const unique = new Map<string, number | null>();
    for (const placement of dto.placements) {
      if (!unique.has(placement.subcategory_id)) {
        unique.set(
          placement.subcategory_id,
          placement.years_experience ?? null,
        );
      }
    }

    const ids = [...unique.keys()];
    if (dto.primary_subcategory_id && !unique.has(dto.primary_subcategory_id)) {
      throw new BadRequestException(
        'primary_subcategory_id must be one of the placement subcategory ids.',
      );
    }

    const primary = dto.primary_subcategory_id ?? ids[0];
    return ids.map((subcategoryId, index) => ({
      subcategory_id: subcategoryId,
      years_experience: unique.get(subcategoryId) ?? null,
      is_primary: subcategoryId === primary,
      position: index,
    }));
  }
}

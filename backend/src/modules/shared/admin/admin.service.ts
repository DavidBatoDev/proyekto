import { Inject, Injectable } from '@nestjs/common';
export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY');
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import type { AdminRepository } from './repositories/admin.repository.interface';
import {
  ApplicationsQueryDto,
  GrantAdminDto,
  MatchAssignDto,
  MatchCandidatesQueryDto,
  ReinstateConsultantDto,
  RejectApplicationDto,
  RevokeConsultantDto,
  SuspendConsultantDto,
} from './dto/admin.dto';
import { TeamsService } from '../../execution/teams/teams.service';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly adminRepo: AdminRepository,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
    private readonly teamsService: TeamsService,
    private readonly authorization: ProjectAuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  getAdminProfile(userId: string) {
    return this.adminRepo.getAdminProfile(userId);
  }
  listApplications(query: ApplicationsQueryDto) {
    return this.adminRepo.listApplications(query);
  }
  getApplicationDetail(id: string) {
    return this.adminRepo.getApplicationDetail(id);
  }
  async approveApplication(id: string, reviewedBy: string) {
    const applicantUserId = await this.adminRepo.getApplicationUserId(id);
    // Provision before granting active consultant capability. An orphaned
    // personal team is harmless and retryable; an active consultant without
    // the required team is not.
    await this.teamsService.provisionPersonalTeam(applicantUserId);
    const approved = await this.adminRepo.approveApplication(id, reviewedBy);
    const approvedUserId = this.userIdFromResult(approved) ?? applicantUserId;

    await Promise.all([
      this.cacheInvalidation.invalidateConsultantsCache(approvedUserId),
      this.cacheInvalidation.invalidateMarketplaceFreelancersCache(),
    ]);
    await this.emitNotification({
      user_id: approvedUserId,
      type_name: 'consultant_application_approved',
      actor_id: reviewedBy,
      content: {
        message: 'Your consultant application has been approved.',
      },
      link_url: `/profile/${approvedUserId}`,
    });
    return approved;
  }
  async rejectApplication(
    id: string,
    reviewedBy: string,
    dto: RejectApplicationDto,
  ) {
    const rejected = await this.adminRepo.rejectApplication(
      id,
      reviewedBy,
      dto.reason,
    );
    const rejectedUserId = this.userIdFromResult(rejected);
    if (rejectedUserId) {
      await this.emitNotification({
        user_id: rejectedUserId,
        type_name: 'consultant_application_rejected',
        actor_id: reviewedBy,
        content: {
          message: 'Your consultant application was not approved.',
          reason: dto.reason ?? null,
        },
        link_url: '/consultant/apply',
      });
    }
    return rejected;
  }
  listConsultants() {
    return this.adminRepo.listConsultants();
  }
  async suspendConsultant(
    userId: string,
    changedBy: string,
    dto: SuspendConsultantDto,
  ) {
    const enrollment = await this.adminRepo.suspendConsultant(
      userId,
      changedBy,
      dto.reason,
    );
    await this.afterConsultantTransition(
      userId,
      changedBy,
      'consultant_suspended',
      'Your consultant access has been suspended.',
      dto.reason,
    );
    return enrollment;
  }
  async reinstateConsultant(
    userId: string,
    changedBy: string,
    dto: ReinstateConsultantDto,
  ) {
    const enrollment = await this.adminRepo.reinstateConsultant(
      userId,
      changedBy,
      dto.reason,
    );
    await this.afterConsultantTransition(
      userId,
      changedBy,
      'consultant_reinstated',
      'Your consultant access has been reinstated.',
      dto.reason,
    );
    return enrollment;
  }
  async revokeConsultant(
    userId: string,
    changedBy: string,
    dto: RevokeConsultantDto,
  ) {
    const enrollment = await this.adminRepo.revokeConsultant(
      userId,
      changedBy,
      dto.reason,
    );
    await this.afterConsultantTransition(
      userId,
      changedBy,
      'consultant_revoked',
      'Your consultant access has been revoked.',
      dto.reason,
    );
    return enrollment;
  }
  listAdmins() {
    return this.adminRepo.listAdmins();
  }
  grantAdmin(userId: string, dto: GrantAdminDto) {
    return this.adminRepo.grantAdmin(userId, dto);
  }
  revokeAdmin(userId: string) {
    return this.adminRepo.revokeAdmin(userId);
  }
  getMatchCandidates(query: MatchCandidatesQueryDto) {
    return this.adminRepo.getMatchCandidates(query);
  }
  async matchAssign(dto: MatchAssignDto) {
    await this.authorization.grant({
      projectId: dto.project_id,
      userId: dto.consultant_id,
      role: 'owner',
      origin: 'direct',
      grantedBy: dto.consultant_id,
    });
    const assigned = await this.adminRepo.assignConsultant(dto.project_id);
    await this.cacheInvalidation.invalidateAllDashboardCache();
    return assigned;
  }
  listProjects() {
    return this.adminRepo.listProjects();
  }
  listUsers() {
    return this.adminRepo.listUsers();
  }

  private userIdFromResult(value: unknown): string | null {
    if (!value || typeof value !== 'object' || !('user_id' in value)) {
      return null;
    }
    return typeof value.user_id === 'string' ? value.user_id : null;
  }

  private async afterConsultantTransition(
    userId: string,
    changedBy: string,
    typeName: string,
    message: string,
    reason?: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheInvalidation.invalidateConsultantsCache(userId),
      this.cacheInvalidation.invalidateMarketplaceFreelancersCache(),
    ]);
    await this.emitNotification({
      user_id: userId,
      type_name: typeName,
      actor_id: changedBy,
      content: { message, reason: reason ?? null },
      link_url: `/profile/${userId}`,
    });
  }

  private async emitNotification(
    payload: Parameters<NotificationsService['createNotification']>[0],
  ): Promise<void> {
    try {
      await this.notifications.createNotification(payload);
    } catch {
      // The durable enrollment transition is authoritative; notification
      // delivery is best-effort and must not turn a successful action into 500.
    }
  }
}

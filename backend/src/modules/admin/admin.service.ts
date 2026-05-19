import { Inject, Injectable } from '@nestjs/common';
export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY');
import { RedisCacheInvalidationService } from '../../common/cache/redis-cache-invalidation.service';
import type { AdminRepository } from './repositories/admin.repository.interface';
import {
  ApplicationsQueryDto,
  GrantAdminDto,
  MatchAssignDto,
  MatchCandidatesQueryDto,
  RejectApplicationDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    @Inject(ADMIN_REPOSITORY) private readonly adminRepo: AdminRepository,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
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
  async approveApplication(id: string) {
    const approved = await this.adminRepo.approveApplication(id);
    const approvedUserId =
      approved && typeof approved === 'object' && 'user_id' in approved
        ? (approved.user_id as string | undefined)
        : undefined;

    await Promise.all([
      this.cacheInvalidation.invalidateConsultantsCache(approvedUserId),
      this.cacheInvalidation.invalidateMarketplaceFreelancersCache(),
    ]);
    return approved;
  }
  rejectApplication(id: string, dto: RejectApplicationDto) {
    return this.adminRepo.rejectApplication(id, dto.reason);
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
    const assigned = await this.adminRepo.assignConsultant(
      dto.project_id,
      dto.consultant_id,
    );
    await this.cacheInvalidation.invalidateAllDashboardCache();
    return assigned;
  }
  listProjects() {
    return this.adminRepo.listProjects();
  }
  listUsers() {
    return this.adminRepo.listUsers();
  }
}

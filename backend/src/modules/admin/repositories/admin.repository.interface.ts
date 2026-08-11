export interface AdminRepository {
  getAdminProfile(userId: string): Promise<unknown>;
  listApplications(filters: { status?: string }): Promise<unknown[]>;
  getApplicationDetail(id: string): Promise<unknown>;
  getApplicationUserId(id: string): Promise<string>;
  approveApplication(id: string): Promise<unknown>;
  rejectApplication(id: string, reason?: string): Promise<unknown>;
  listAdmins(): Promise<unknown[]>;
  grantAdmin(
    userId: string,
    data: { access_level?: string; department?: string },
  ): Promise<unknown>;
  revokeAdmin(userId: string): Promise<void>;
  getMatchCandidates(filters: {
    project_id?: string;
    q?: string;
    niche?: string;
    availability?: string;
    minRate?: number;
    maxRate?: number;
  }): Promise<unknown[]>;
  assignConsultant(projectId: string): Promise<unknown>;
  listProjects(): Promise<unknown[]>;
  listUsers(): Promise<unknown[]>;
}

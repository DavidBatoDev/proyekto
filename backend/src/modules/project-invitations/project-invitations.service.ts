import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectInvitationsRepository } from './project-invitations.repository.supabase';
import type {
  CreateInvitationLinkDto,
  InvitationRequestStatus,
  ListInvitationRequestsQueryDto,
  ReviewInvitationRequestDto,
  SubmitInvitationRequestDto,
} from './dto/project-invitations.dto';

@Injectable()
export class ProjectInvitationsService {
  constructor(
    private readonly repo: ProjectInvitationsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // LINKS
  // -------------------------------------------------------------------------

  async getLinksForProject(projectId: string, callerId: string): Promise<unknown[]> {
    await this.assertIsConsultant(projectId, callerId);
    return this.repo.getLinksForProject(projectId);
  }

  async createLink(
    projectId: string,
    callerId: string,
    dto: CreateInvitationLinkDto,
  ): Promise<unknown> {
    await this.assertIsConsultant(projectId, callerId);
    return this.repo.createLink(projectId, callerId, dto);
  }

  async revokeLink(
    projectId: string,
    linkId: string,
    callerId: string,
  ): Promise<{ revoked: boolean }> {
    await this.assertIsConsultant(projectId, callerId);
    await this.repo.revokeLink(linkId, projectId);
    return { revoked: true };
  }

  // -------------------------------------------------------------------------
  // PUBLIC LINK INFO
  // -------------------------------------------------------------------------

  async getLinkInfo(token: string): Promise<unknown> {
    const link = await this.repo.getLinkByToken(token);

    if (!link) throw new NotFoundException('Invitation link not found or has been revoked.');

    if (!link.is_active) {
      throw new BadRequestException('This invitation link has been revoked.');
    }

    if (link.expires_at && new Date(link.expires_at as string) < new Date()) {
      throw new BadRequestException('This invitation link has expired.');
    }

    // Return safe subset for public consumption
    return {
      id: link.id,
      token: link.token,
      role_type: link.role_type,
      project: link.project,
    };
  }

  // -------------------------------------------------------------------------
  // REQUESTS
  // -------------------------------------------------------------------------

  async submitRequest(
    token: string,
    callerId: string,
    dto: SubmitInvitationRequestDto,
  ): Promise<unknown> {
    const link = await this.repo.getLinkByToken(token);

    if (!link || !link.is_active) {
      throw new BadRequestException('This invitation link is invalid or has been revoked.');
    }

    if (link.expires_at && new Date(link.expires_at as string) < new Date()) {
      throw new BadRequestException('This invitation link has expired.');
    }

    const projectId = link.project_id as string;
    const roleRequested = link.role_type as string;

    // Check if caller is already the project consultant
    const consultantId = await this.repo.getProjectConsultantId(projectId);
    if (consultantId === callerId) {
      throw new BadRequestException('You are already the consultant for this project.');
    }

    // Check for existing pending request
    const existing = await this.repo.getRequesterExistingRequest(
      projectId,
      callerId,
      roleRequested as any,
    );

    if (existing) {
      if (existing.status === 'pending') {
        throw new BadRequestException('You already have a pending request for this role.');
      }
      if (existing.status === 'approved') {
        throw new BadRequestException('Your request has already been approved.');
      }
      // rejected → allow re-request
    }

    const callerProfile = await this.repo.getProfileById(callerId);
    if (!callerProfile) throw new BadRequestException('User profile not found.');

    const request = await this.repo.createRequest({
      invitationLinkId: link.id as string,
      projectId,
      requesterId: callerId,
      requesterEmail: callerProfile.email,
      roleRequested: roleRequested as any,
      note: dto.note,
    });

    // Notify the consultant
    if (consultantId) {
      await this.safeNotify({
        user_id: consultantId,
        project_id: projectId,
        type_name: 'project_updated',
        actor_id: callerId,
        content: {
          message: `${callerProfile.display_name || callerProfile.email} requested access as ${roleRequested}.`,
          request_id: (request as any).id,
          role_requested: roleRequested,
        },
        link_url: `/project/${projectId}/invitations`,
      });
    }

    return request;
  }

  async getRequests(
    projectId: string,
    callerId: string,
    query: ListInvitationRequestsQueryDto,
  ): Promise<unknown[]> {
    await this.assertIsConsultant(projectId, callerId);
    return this.repo.getRequestsForProject(projectId, query.status as InvitationRequestStatus | undefined);
  }

  async reviewRequest(
    requestId: string,
    callerId: string,
    dto: ReviewInvitationRequestDto,
  ): Promise<unknown> {
    const request = await this.repo.getRequestById(requestId);
    if (!request) throw new NotFoundException('Request not found.');

    const projectId = request.project_id as string;
    await this.assertIsConsultant(projectId, callerId);

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed.');
    }

    const reviewed = await this.repo.reviewRequest(
      requestId,
      callerId,
      dto.status,
      dto.rejection_reason,
    );

    const requesterId = request.requester_id as string;
    const roleRequested = request.role_requested as string;

    if (dto.status === 'approved') {
      await this.applyApproval(projectId, requesterId, roleRequested as any);

      await this.safeNotify({
        user_id: requesterId,
        project_id: projectId,
        type_name: 'project_invite_received',
        actor_id: callerId,
        content: {
          message: `Your request to join as ${roleRequested} has been approved!`,
          request_id: requestId,
          role: roleRequested,
        },
        link_url: `/project/${projectId}/overview`,
      });
    } else {
      await this.safeNotify({
        user_id: requesterId,
        project_id: projectId,
        type_name: 'project_updated',
        actor_id: callerId,
        content: {
          message: `Your request to join as ${roleRequested} was not approved.`,
          request_id: requestId,
          rejection_reason: dto.rejection_reason ?? null,
        },
        link_url: null,
      });
    }

    return reviewed;
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  private async assertIsConsultant(projectId: string, userId: string): Promise<void> {
    const consultantId = await this.repo.getProjectConsultantId(projectId);
    if (consultantId !== userId) {
      throw new ForbiddenException('Only the project consultant can perform this action.');
    }
  }

  private async applyApproval(
    projectId: string,
    userId: string,
    role: 'consultant' | 'freelancer' | 'client',
  ): Promise<void> {
    if (role === 'freelancer') {
      await this.repo.approveFreelancer(projectId, userId);
    } else if (role === 'consultant') {
      await this.repo.approveConsultant(projectId, userId);
    } else if (role === 'client') {
      await this.repo.approveClientTransfer(projectId, userId);
    }
  }

  private async safeNotify(payload: {
    user_id: string;
    project_id?: string;
    type_name: string;
    actor_id?: string;
    content: Record<string, unknown>;
    link_url?: string | null;
  }): Promise<void> {
    try {
      await this.notifications.createNotification({
        user_id: payload.user_id,
        project_id: payload.project_id,
        type_name: payload.type_name,
        actor_id: payload.actor_id,
        content: payload.content,
        link_url: payload.link_url ?? undefined,
      });
    } catch {
      // Notifications are non-critical — don't fail the main flow
    }
  }
}

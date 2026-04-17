import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { randomBytes } from 'crypto';
import type {
  CreateInvitationLinkDto,
  InvitationRoleType,
  InvitationRequestStatus,
} from './dto/project-invitations.dto';
import {
  getTemplateByKey,
  resolvePermissionTemplateKey,
} from '../projects/permissions/project-permissions';

@Injectable()
export class ProjectInvitationsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  // -------------------------------------------------------------------------
  // INVITATION LINKS
  // -------------------------------------------------------------------------

  async getLinksForProject(projectId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('project_invitation_links')
      .select('id, project_id, token, role_type, is_active, expires_at, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createLink(
    projectId: string,
    createdBy: string,
    dto: CreateInvitationLinkDto,
  ): Promise<any> {
    // Deactivate any existing active link for this role on this project
    await this.db
      .from('project_invitation_links')
      .update({ is_active: false })
      .eq('project_id', projectId)
      .eq('role_type', dto.role_type)
      .eq('is_active', true);

    const token = randomBytes(24).toString('hex');

    const { data, error } = await this.db
      .from('project_invitation_links')
      .insert({
        project_id: projectId,
        token,
        role_type: dto.role_type,
        created_by: createdBy,
        is_active: true,
        expires_at: dto.expires_at ?? null,
      })
      .select('id, project_id, token, role_type, is_active, expires_at, created_at')
      .single();

    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to create link');
    return data;
  }

  async revokeLink(linkId: string, projectId: string): Promise<void> {
    const { error } = await this.db
      .from('project_invitation_links')
      .update({ is_active: false })
      .eq('id', linkId)
      .eq('project_id', projectId);

    if (error) throw new BadRequestException(error.message);
  }

  async getLinkByToken(token: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('project_invitation_links')
      .select(
        'id, project_id, token, role_type, is_active, expires_at, created_at, project:projects(id, title, banner_url, status, consultant_id, consultant:profiles!projects_consultant_id_fkey(id, display_name, avatar_url))',
      )
      .eq('token', token)
      .single();

    if (error && error.code !== 'PGRST116') throw new BadRequestException(error.message);
    return data ?? null;
  }

  // -------------------------------------------------------------------------
  // INVITATION REQUESTS
  // -------------------------------------------------------------------------

  async getRequesterExistingRequest(
    projectId: string,
    requesterId: string,
    roleRequested: InvitationRoleType,
  ): Promise<any | null> {
    const { data } = await this.db
      .from('project_invitation_requests')
      .select('id, status, role_requested, created_at')
      .eq('project_id', projectId)
      .eq('requester_id', requesterId)
      .eq('role_requested', roleRequested)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data ?? null;
  }

  async createRequest(params: {
    invitationLinkId: string;
    projectId: string;
    requesterId: string;
    requesterEmail: string;
    roleRequested: InvitationRoleType;
    note?: string;
  }): Promise<any> {
    const { data, error } = await this.db
      .from('project_invitation_requests')
      .insert({
        invitation_link_id: params.invitationLinkId,
        project_id: params.projectId,
        requester_id: params.requesterId,
        requester_email: params.requesterEmail,
        role_requested: params.roleRequested,
        note: params.note ?? null,
        status: 'pending',
      })
      .select('id, project_id, role_requested, status, note, created_at')
      .single();

    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to submit request');
    return data;
  }

  async getRequestsForProject(
    projectId: string,
    status?: InvitationRequestStatus,
  ): Promise<any[]> {
    let query = this.db
      .from('project_invitation_requests')
      .select(
        'id, project_id, role_requested, status, note, rejection_reason, reviewed_at, created_at, requester:profiles!project_invitation_requests_requester_id_fkey(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getRequestById(requestId: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('project_invitation_requests')
      .select('id, project_id, requester_id, requester_email, role_requested, status, note, rejection_reason, reviewed_by, reviewed_at, created_at')
      .eq('id', requestId)
      .single();

    if (error && error.code !== 'PGRST116') throw new NotFoundException('Request not found');
    return data ?? null;
  }

  async reviewRequest(
    requestId: string,
    reviewedBy: string,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('project_invitation_requests')
      .update({
        status,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectionReason ?? null,
      })
      .eq('id', requestId)
      .select('id, project_id, requester_id, role_requested, status')
      .single();

    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to review request');
    return data;
  }

  // -------------------------------------------------------------------------
  // APPROVAL SIDE EFFECTS
  // -------------------------------------------------------------------------

  async approveFreelancer(projectId: string, userId: string): Promise<void> {
    const { data: project } = await this.db
      .from('projects')
      .select('id, client_id, consultant_id')
      .eq('id', projectId)
      .single();

    if (!project) throw new NotFoundException('Project not found');

    const permissions = getTemplateByKey(
      resolvePermissionTemplateKey(
        { id: projectId, client_id: project.client_id as string, consultant_id: project.consultant_id as string | null },
        { id: 'n/a', user_id: userId, role: 'member' },
      ),
    );

    const { error } = await this.db
      .from('project_members')
      .upsert(
        {
          project_id: projectId,
          user_id: userId,
          role: 'member',
          position: 'Freelancer',
          permissions_json: permissions,
        },
        { onConflict: 'project_id,user_id' },
      );

    if (error) throw new BadRequestException(error.message);
  }

  async approveConsultant(projectId: string, userId: string): Promise<void> {
    const { data: project } = await this.db
      .from('projects')
      .select('id, client_id, consultant_id')
      .eq('id', projectId)
      .single();

    if (!project) throw new NotFoundException('Project not found');

    const permissions = getTemplateByKey('consultant');

    const { error } = await this.db
      .from('project_members')
      .upsert(
        {
          project_id: projectId,
          user_id: userId,
          role: 'consultant',
          position: 'Consultant',
          permissions_json: permissions,
        },
        { onConflict: 'project_id,user_id' },
      );

    if (error) throw new BadRequestException(error.message);
  }

  async approveClientTransfer(projectId: string, newClientId: string): Promise<void> {
    // Get current client_id before transfer
    const { data: project } = await this.db
      .from('projects')
      .select('id, client_id')
      .eq('id', projectId)
      .single();

    if (!project) throw new NotFoundException('Project not found');

    const oldClientId = project.client_id as string;

    // Transfer ownership
    const { error: updateError } = await this.db
      .from('projects')
      .update({ client_id: newClientId })
      .eq('id', projectId);

    if (updateError) throw new BadRequestException(updateError.message);

    // Add new client as member with client permissions
    const clientPermissions = getTemplateByKey('client');
    await this.db
      .from('project_members')
      .upsert(
        {
          project_id: projectId,
          user_id: newClientId,
          role: 'client',
          position: 'Client',
          permissions_json: clientPermissions,
        },
        { onConflict: 'project_id,user_id' },
      );

    // Retain old client as a member if they aren't already
    if (oldClientId && oldClientId !== newClientId) {
      const memberPermissions = getTemplateByKey('member');
      await this.db
        .from('project_members')
        .upsert(
          {
            project_id: projectId,
            user_id: oldClientId,
            role: 'member',
            position: 'Former Client',
            permissions_json: memberPermissions,
          },
          { onConflict: 'project_id,user_id' },
        );
    }
  }

  async getProfileById(userId: string): Promise<{ email: string; display_name: string } | null> {
    const { data } = await this.db
      .from('profiles')
      .select('email, display_name')
      .eq('id', userId)
      .maybeSingle();

    return data ?? null;
  }

  async getProjectConsultantId(projectId: string): Promise<string | null> {
    const { data } = await this.db
      .from('projects')
      .select('consultant_id')
      .eq('id', projectId)
      .maybeSingle();

    return (data?.consultant_id as string | null) ?? null;
  }
}

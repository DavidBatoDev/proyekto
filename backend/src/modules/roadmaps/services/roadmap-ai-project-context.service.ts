import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  htmlToText,
  truncatePromptText,
} from '../../../common/utils/html-to-text.util';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  RoadmapAiNoProjectResponseDto,
  RoadmapAiProjectBriefResponseDto,
  RoadmapAiProjectContextDto,
  RoadmapAiProjectContextMemberDto,
  RoadmapAiProjectDto,
  RoadmapAiProjectMeetingDto,
  RoadmapAiProjectMeetingParticipantDto,
  RoadmapAiProjectMeetingsQueryDto,
  RoadmapAiProjectMeetingsResponseDto,
  RoadmapAiProjectMemberDetailsResponseDto,
  RoadmapAiProjectResourceFolderDto,
  RoadmapAiProjectResourceLinkDto,
  RoadmapAiProjectResourcesResponseDto,
} from '../dto/roadmap-ai-project-context.dto';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';

const BRIEF_EXCERPT_MAX_CHARS = 1_200;
const FULL_BRIEF_MAX_CHARS = 12_000;
const CUSTOM_FIELD_LIMIT = 50;
const CUSTOM_FIELD_KEY_MAX_CHARS = 120;
const CUSTOM_FIELD_VALUE_MAX_CHARS = 500;
const COMPACT_CUSTOM_FIELD_KEY_LIMIT = 20;
const COMPACT_MEMBER_LIMIT = 15;
const COMPACT_TEAM_LIMIT = 8;
const PROJECT_SKILL_LIMIT = 20;
const RESOURCE_FOLDER_LIMIT = 50;
const RESOURCE_LINK_LIMIT = 50;
const RESOURCE_DESCRIPTION_MAX_CHARS = 500;
const RESOURCE_TOP_TITLE_LIMIT = 10;
const RESOURCE_FOLDER_NAME_MAX_CHARS = 120;
const RESOURCE_TITLE_MAX_CHARS = 255;
const URL_MAX_CHARS = 2_048;
const MEETING_DEFAULT_LIMIT = 10;
const MEETING_MAX_LIMIT = 50;
const MEETING_DESCRIPTION_MAX_CHARS = 300;
const MEETING_TITLE_MAX_CHARS = 200;
const MEETING_PARTICIPANT_LIMIT = 20;
const MEETING_PAGE_PARTICIPANT_LIMIT = 100;
const DISPLAY_NAME_MAX_CHARS = 200;
const EMAIL_MAX_CHARS = 320;
const SHORT_LABEL_MAX_CHARS = 80;
const MEMBER_BIO_MAX_CHARS = 600;
const MEMBER_SKILL_LIMIT = 30;
const MEMBER_TEAM_LIMIT = 20;
const CAPABILITY_LIMIT = 50;
const CAPABILITY_KEY_MAX_CHARS = 80;
const CAPABILITY_VALUE_MAX_CHARS = 200;

type RoadmapContextMeta = {
  projectId: string | null;
  ownerId: string | null;
};

type LatestBrief = {
  projectSummary: string | null;
  customFields: Array<Record<string, unknown>>;
};

@Injectable()
export class RoadmapAiProjectContextService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
  ) {}

  async getProjectContext(
    roadmapId: string,
    userId: string,
    _traceId?: string,
  ): Promise<RoadmapAiProjectContextDto> {
    void _traceId;
    const roadmap = await this.getAccessibleRoadmap(roadmapId, userId);
    if (!roadmap.projectId) return this.emptyProjectContext();

    const projectId = roadmap.projectId;
    const [project, brief, members, teams, resources, meetings] =
      await Promise.all([
        this.readProject(projectId),
        this.readLatestBrief(projectId),
        this.readCompactMembers(projectId, roadmap.ownerId),
        this.readAttachedTeamNames(projectId),
        this.readResourceSummary(projectId),
        this.readMeetingSummary(projectId),
      ]);

    if (!project) return this.emptyProjectContext();

    const fullBriefText = htmlToText(brief.projectSummary, 1);
    const excerpt = htmlToText(brief.projectSummary, BRIEF_EXCERPT_MAX_CHARS);

    return {
      project,
      brief_excerpt: excerpt || null,
      has_full_brief: fullBriefText.length > 0,
      custom_field_keys: brief.customFields
        .map((field) => this.readTrimmedString(field.key))
        .filter((key): key is string => !!key)
        .map((key) => truncatePromptText(key, CUSTOM_FIELD_KEY_MAX_CHARS))
        .slice(0, COMPACT_CUSTOM_FIELD_KEY_LIMIT),
      members,
      teams,
      resource_summary: resources,
      meeting_summary: meetings,
    };
  }

  async getProjectBrief(
    roadmapId: string,
    userId: string,
    _traceId?: string,
  ): Promise<RoadmapAiProjectBriefResponseDto | RoadmapAiNoProjectResponseDto> {
    void _traceId;
    const roadmap = await this.getAccessibleRoadmap(roadmapId, userId);
    if (!roadmap.projectId) return this.noProject();

    const brief = await this.readLatestBrief(roadmap.projectId);
    const projectSummary = htmlToText(
      brief.projectSummary,
      FULL_BRIEF_MAX_CHARS,
    );

    return {
      project_id: roadmap.projectId,
      project_summary: projectSummary || null,
      custom_fields: brief.customFields,
    };
  }

  async getProjectResources(
    roadmapId: string,
    userId: string,
    _traceId?: string,
  ): Promise<
    RoadmapAiProjectResourcesResponseDto | RoadmapAiNoProjectResponseDto
  > {
    void _traceId;
    const roadmap = await this.getAccessibleRoadmap(roadmapId, userId);
    if (!roadmap.projectId) return this.noProject();

    const projectId = roadmap.projectId;
    const [foldersResult, linksResult] = await Promise.all([
      this.db
        .from('project_resource_folders')
        .select('id, name, position')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .limit(RESOURCE_FOLDER_LIMIT),
      this.db
        .from('project_resource_links')
        .select('id, folder_id, title, url, description, position, created_at')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(RESOURCE_LINK_LIMIT),
    ]);
    this.throwOnQueryError(foldersResult.error);
    this.throwOnQueryError(linksResult.error);

    const folders = (foldersResult.data ?? [])
      .flatMap((raw) => {
        const row = this.asRecord(raw);
        const id = this.readTrimmedString(row?.id);
        const name = this.readTrimmedString(row?.name);
        if (!id || !name) return [];
        return [
          {
            id,
            name: truncatePromptText(name, RESOURCE_FOLDER_NAME_MAX_CHARS),
            position: this.readNumber(row?.position) ?? 0,
          } satisfies RoadmapAiProjectResourceFolderDto,
        ];
      })
      .slice(0, RESOURCE_FOLDER_LIMIT);

    const links = (linksResult.data ?? [])
      .flatMap((raw) => {
        const row = this.asRecord(raw);
        const id = this.readTrimmedString(row?.id);
        const title = this.readTrimmedString(row?.title);
        const url = this.readTrimmedString(row?.url);
        if (!id || !title || !url) return [];
        const description = this.readTrimmedString(row?.description);
        return [
          {
            id,
            folder_id: this.readTrimmedString(row?.folder_id),
            title: truncatePromptText(title, RESOURCE_TITLE_MAX_CHARS),
            url: truncatePromptText(url, URL_MAX_CHARS),
            description: description
              ? htmlToText(description, RESOURCE_DESCRIPTION_MAX_CHARS)
              : null,
            position: this.readNumber(row?.position) ?? 0,
          } satisfies RoadmapAiProjectResourceLinkDto,
        ];
      })
      .slice(0, RESOURCE_LINK_LIMIT);

    return { project_id: projectId, folders, links };
  }

  async getProjectMeetings(
    roadmapId: string,
    userId: string,
    queryDto: RoadmapAiProjectMeetingsQueryDto = {},
    _traceId?: string,
  ): Promise<
    RoadmapAiProjectMeetingsResponseDto | RoadmapAiNoProjectResponseDto
  > {
    void _traceId;
    const roadmap = await this.getAccessibleRoadmap(roadmapId, userId);
    if (!roadmap.projectId) return this.noProject();

    const projectId = roadmap.projectId;
    const window = queryDto.window ?? 'upcoming';
    const limit = Math.min(
      Math.max(queryDto.limit ?? MEETING_DEFAULT_LIMIT, 1),
      MEETING_MAX_LIMIT,
    );
    const now = new Date().toISOString();

    let meetingsQuery = this.db
      .from('meetings')
      .select(
        'id, title, description, type, scheduled_at, ends_at, status, meeting_url, ' +
          'participants:meeting_participants(id, user_id, guest_email, guest_name, role, response, ' +
          'profile:profiles!meeting_participants_user_id_fkey(id, display_name))',
      )
      .eq('project_id', projectId);

    if (window === 'upcoming') {
      meetingsQuery = meetingsQuery
        .gte('scheduled_at', now)
        .eq('status', 'scheduled')
        .order('scheduled_at', { ascending: true });
    } else if (window === 'recent') {
      meetingsQuery = meetingsQuery
        .lt('scheduled_at', now)
        .order('scheduled_at', { ascending: false });
    } else {
      meetingsQuery = meetingsQuery.order('scheduled_at', { ascending: false });
    }

    const { data, error } = await meetingsQuery
      .order('id', { ascending: true })
      .limit(limit);
    this.throwOnQueryError(error);

    const meetings: RoadmapAiProjectMeetingDto[] = [];
    let remainingParticipants = MEETING_PAGE_PARTICIPANT_LIMIT;
    for (const raw of data ?? []) {
      if (meetings.length >= limit) break;
      const mapped = this.mapMeeting(raw);
      if (!mapped) continue;
      mapped.participants = mapped.participants.slice(0, remainingParticipants);
      remainingParticipants -= mapped.participants.length;
      meetings.push(mapped);
    }

    return { project_id: projectId, window, meetings };
  }

  async getMemberDetails(
    roadmapId: string,
    memberId: string,
    userId: string,
    _traceId?: string,
  ): Promise<
    RoadmapAiProjectMemberDetailsResponseDto | RoadmapAiNoProjectResponseDto
  > {
    void _traceId;
    const roadmap = await this.getAccessibleRoadmap(roadmapId, userId);
    if (!roadmap.projectId) return this.noProject();

    const projectId = roadmap.projectId;
    const { data: accessData, error: accessError } = await this.db
      .from('project_access')
      .select('user_id, role, capabilities')
      .eq('project_id', projectId)
      .eq('user_id', memberId)
      .maybeSingle();
    this.throwOnQueryError(accessError);

    const access = this.asRecord(accessData);
    if (!access && roadmap.ownerId !== memberId) {
      throw new NotFoundException('Project member not found');
    }

    const [profileResult, skillsResult, curationResult] = await Promise.all([
      this.db
        .from('profiles')
        .select('id, display_name, active_persona, bio')
        .eq('id', memberId)
        .maybeSingle(),
      this.db
        .from('user_skills')
        .select('skill:skills(name)')
        .eq('user_id', memberId),
      this.db
        .from('project_team_members')
        .select('team_id')
        .eq('project_id', projectId)
        .eq('user_id', memberId)
        .order('team_id', { ascending: true })
        .limit(MEMBER_TEAM_LIMIT),
    ]);
    this.throwOnQueryError(profileResult.error);
    this.throwOnQueryError(skillsResult.error);
    this.throwOnQueryError(curationResult.error);

    const profile = this.asRecord(profileResult.data);
    if (!profile) throw new NotFoundException('Project member not found');

    const teamIds = (curationResult.data ?? [])
      .map((row) => this.readTrimmedString(this.asRecord(row)?.team_id))
      .filter((id): id is string => !!id)
      .slice(0, MEMBER_TEAM_LIMIT);
    const teams = await this.readTeamNames(teamIds);
    const skills = (skillsResult.data ?? [])
      .map((raw) => {
        const row = this.asRecord(raw);
        const skill = this.asSingleRecord(row?.skill);
        return this.readTrimmedString(skill?.name);
      })
      .filter((name): name is string => !!name)
      .map((name) => truncatePromptText(name, CUSTOM_FIELD_KEY_MAX_CHARS))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MEMBER_SKILL_LIMIT);
    const bio = this.readTrimmedString(profile.bio);

    return {
      member: {
        id: this.readTrimmedString(profile.id) ?? memberId,
        display_name: this.truncatedString(
          profile.display_name,
          DISPLAY_NAME_MAX_CHARS,
        ),
        persona: this.truncatedString(
          profile.active_persona,
          SHORT_LABEL_MAX_CHARS,
        ),
        bio: bio ? htmlToText(bio, MEMBER_BIO_MAX_CHARS) : null,
        skills,
        role:
          this.readTrimmedString(access?.role) ??
          (roadmap.ownerId === memberId ? 'roadmap_owner' : null),
        capabilities: this.normalizeCapabilities(access?.capabilities),
        teams,
      },
    };
  }

  private async getAccessibleRoadmap(
    roadmapId: string,
    userId: string,
  ): Promise<RoadmapContextMeta> {
    const roadmap = this.asRecord(
      await this.roadmapsRepo.findById(roadmapId, userId),
    );
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return {
      projectId: this.readTrimmedString(roadmap.project_id),
      ownerId: this.readTrimmedString(roadmap.owner_id),
    };
  }

  private async readProject(
    projectId: string,
  ): Promise<RoadmapAiProjectDto | null> {
    const { data, error } = await this.db
      .from('projects')
      .select(
        'id, title, status, category, project_state, duration, budget_range, ' +
          'funding_status, start_date, skills',
      )
      .eq('id', projectId)
      .maybeSingle();
    this.throwOnQueryError(error);

    const row = this.asRecord(data);
    const id = this.readTrimmedString(row?.id);
    const title = this.readTrimmedString(row?.title);
    if (!row || !id || !title) return null;

    return {
      id,
      title: truncatePromptText(title, MEETING_TITLE_MAX_CHARS),
      status:
        this.truncatedString(row.status, SHORT_LABEL_MAX_CHARS) ?? 'draft',
      category: this.truncatedString(row.category, DISPLAY_NAME_MAX_CHARS),
      project_state: this.truncatedString(
        row.project_state,
        DISPLAY_NAME_MAX_CHARS,
      ),
      duration: this.truncatedString(row.duration, DISPLAY_NAME_MAX_CHARS),
      budget_range: this.truncatedString(
        row.budget_range,
        DISPLAY_NAME_MAX_CHARS,
      ),
      funding_status: this.truncatedString(
        row.funding_status,
        DISPLAY_NAME_MAX_CHARS,
      ),
      start_date: this.truncatedString(row.start_date, SHORT_LABEL_MAX_CHARS),
      skills: this.normalizeProjectSkills(row.skills),
    };
  }

  private async readLatestBrief(projectId: string): Promise<LatestBrief> {
    const { data, error } = await this.db
      .from('project_briefs')
      .select('project_summary, custom_fields, version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    this.throwOnQueryError(error);

    const row = this.asRecord(data);
    return {
      projectSummary: this.readString(row?.project_summary),
      customFields: this.normalizeCustomFields(row?.custom_fields),
    };
  }

  private async readCompactMembers(
    projectId: string,
    roadmapOwnerId: string | null,
  ): Promise<RoadmapAiProjectContextMemberDto[]> {
    const { data: accessData, error: accessError } = await this.db
      .from('project_access')
      .select('user_id, role, granted_at')
      .eq('project_id', projectId)
      .order('granted_at', { ascending: true })
      .order('user_id', { ascending: true })
      .limit(50);
    this.throwOnQueryError(accessError);

    const accessById = new Map<string, Record<string, unknown>>();
    const orderedIds: string[] = [];
    if (roadmapOwnerId) orderedIds.push(roadmapOwnerId);
    for (const raw of accessData ?? []) {
      const row = this.asRecord(raw);
      const id = this.readTrimmedString(row?.user_id);
      if (!id) continue;
      accessById.set(id, row ?? {});
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }

    const memberIds = orderedIds.slice(0, COMPACT_MEMBER_LIMIT);
    if (memberIds.length === 0) return [];

    const { data: profileData, error: profileError } = await this.db
      .from('profiles')
      .select('id, display_name, active_persona')
      .in('id', memberIds);
    this.throwOnQueryError(profileError);

    const profilesById = new Map<string, Record<string, unknown>>();
    for (const raw of profileData ?? []) {
      const profile = this.asRecord(raw);
      const id = this.readTrimmedString(profile?.id);
      if (id && profile) profilesById.set(id, profile);
    }

    return memberIds.map((id) => {
      const profile = profilesById.get(id);
      const access = accessById.get(id);
      return {
        id,
        display_name: this.truncatedString(
          profile?.display_name,
          DISPLAY_NAME_MAX_CHARS,
        ),
        role:
          this.readTrimmedString(access?.role) ??
          (id === roadmapOwnerId ? 'roadmap_owner' : null),
        persona: this.truncatedString(
          profile?.active_persona,
          SHORT_LABEL_MAX_CHARS,
        ),
      };
    });
  }

  private async readAttachedTeamNames(projectId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('project_teams')
      .select('team_id, is_primary, attached_at, team:teams(id, name)')
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false })
      .order('attached_at', { ascending: true })
      .order('team_id', { ascending: true })
      .limit(COMPACT_TEAM_LIMIT);
    this.throwOnQueryError(error);

    return (data ?? [])
      .map((raw) => {
        const team = this.asSingleRecord(this.asRecord(raw)?.team);
        return this.readTrimmedString(team?.name);
      })
      .filter((name): name is string => !!name)
      .map((name) => truncatePromptText(name, RESOURCE_FOLDER_NAME_MAX_CHARS))
      .slice(0, COMPACT_TEAM_LIMIT);
  }

  private async readTeamNames(teamIds: string[]): Promise<string[]> {
    if (teamIds.length === 0) return [];
    const uniqueIds = [...new Set(teamIds)];
    const { data, error } = await this.db
      .from('teams')
      .select('id, name')
      .in('id', uniqueIds);
    this.throwOnQueryError(error);

    const nameById = new Map<string, string>();
    for (const raw of data ?? []) {
      const row = this.asRecord(raw);
      const id = this.readTrimmedString(row?.id);
      const name = this.readTrimmedString(row?.name);
      if (id && name) {
        nameById.set(
          id,
          truncatePromptText(name, RESOURCE_FOLDER_NAME_MAX_CHARS),
        );
      }
    }
    return uniqueIds
      .flatMap((id) => {
        const name = nameById.get(id);
        return name ? [name] : [];
      })
      .slice(0, MEMBER_TEAM_LIMIT);
  }

  private async readResourceSummary(projectId: string): Promise<{
    count: number;
    top_titles: string[];
  }> {
    const [countResult, titlesResult] = await Promise.all([
      this.db
        .from('project_resource_links')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      this.db
        .from('project_resource_links')
        .select('id, title, position, created_at')
        .eq('project_id', projectId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(RESOURCE_TOP_TITLE_LIMIT),
    ]);
    this.throwOnQueryError(countResult.error);
    this.throwOnQueryError(titlesResult.error);

    return {
      count: countResult.count ?? 0,
      top_titles: (titlesResult.data ?? [])
        .map((row) => this.readTrimmedString(this.asRecord(row)?.title))
        .filter((title): title is string => !!title)
        .map((title) => truncatePromptText(title, RESOURCE_TITLE_MAX_CHARS))
        .slice(0, RESOURCE_TOP_TITLE_LIMIT),
    };
  }

  private async readMeetingSummary(projectId: string): Promise<{
    upcoming_count: number;
    next: { title: string; scheduled_at: string } | null;
  }> {
    const now = new Date().toISOString();
    const [countResult, nextResult] = await Promise.all([
      this.db
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'scheduled')
        .gte('scheduled_at', now),
      this.db
        .from('meetings')
        .select('id, title, scheduled_at')
        .eq('project_id', projectId)
        .eq('status', 'scheduled')
        .gte('scheduled_at', now)
        .order('scheduled_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    this.throwOnQueryError(countResult.error);
    this.throwOnQueryError(nextResult.error);

    const nextRow = this.asRecord(nextResult.data);
    const title = this.truncatedString(nextRow?.title, MEETING_TITLE_MAX_CHARS);
    const scheduledAt = this.readTrimmedString(nextRow?.scheduled_at);
    return {
      upcoming_count: countResult.count ?? 0,
      next: title && scheduledAt ? { title, scheduled_at: scheduledAt } : null,
    };
  }

  private mapMeeting(raw: unknown): RoadmapAiProjectMeetingDto | null {
    const row = this.asRecord(raw);
    const id = this.readTrimmedString(row?.id);
    const title = this.readTrimmedString(row?.title);
    const scheduledAt = this.readTrimmedString(row?.scheduled_at);
    if (!row || !id || !title || !scheduledAt) return null;

    const participantRows = Array.isArray(row.participants)
      ? row.participants
      : [];
    const participants = participantRows
      .flatMap((participantRaw) => {
        const participant = this.mapMeetingParticipant(participantRaw);
        return participant ? [participant] : [];
      })
      .sort((a, b) =>
        this.participantSortKey(a).localeCompare(this.participantSortKey(b)),
      )
      .slice(0, MEETING_PARTICIPANT_LIMIT);
    const description = this.readTrimmedString(row.description);

    return {
      id,
      title: truncatePromptText(title, MEETING_TITLE_MAX_CHARS),
      description: description
        ? truncatePromptText(description, MEETING_DESCRIPTION_MAX_CHARS)
        : null,
      type:
        this.truncatedString(row.type, SHORT_LABEL_MAX_CHARS) ?? 'status_sync',
      scheduled_at: scheduledAt,
      ends_at: this.readTrimmedString(row.ends_at),
      status:
        this.truncatedString(row.status, SHORT_LABEL_MAX_CHARS) ?? 'scheduled',
      url: this.truncatedString(row.meeting_url, URL_MAX_CHARS),
      participants,
    };
  }

  private mapMeetingParticipant(
    raw: unknown,
  ): RoadmapAiProjectMeetingParticipantDto | null {
    const row = this.asRecord(raw);
    if (!row) return null;
    const profile = this.asSingleRecord(row.profile);
    return {
      user_id: this.readTrimmedString(row.user_id),
      display_name: this.truncatedString(
        profile?.display_name,
        DISPLAY_NAME_MAX_CHARS,
      ),
      guest_email: this.truncatedString(row.guest_email, EMAIL_MAX_CHARS),
      guest_name: this.truncatedString(row.guest_name, DISPLAY_NAME_MAX_CHARS),
      role: this.truncatedString(row.role, SHORT_LABEL_MAX_CHARS) ?? 'attendee',
      response:
        this.truncatedString(row.response, SHORT_LABEL_MAX_CHARS) ?? 'pending',
    };
  }

  private participantSortKey(
    participant: RoadmapAiProjectMeetingParticipantDto,
  ): string {
    const roleRank = participant.role === 'host' ? '0' : '1';
    return `${roleRank}:${
      participant.display_name ??
      participant.guest_name ??
      participant.user_id ??
      ''
    }`;
  }

  private normalizeProjectSkills(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const skills: string[] = [];
    for (const raw of value) {
      let name = this.readTrimmedString(raw);
      if (!name) {
        const row = this.asRecord(raw);
        name =
          this.readTrimmedString(row?.name) ??
          this.readTrimmedString(row?.label) ??
          this.readTrimmedString(row?.title) ??
          this.readTrimmedString(row?.value);
      }
      if (!name || skills.includes(name)) continue;
      skills.push(truncatePromptText(name, CUSTOM_FIELD_KEY_MAX_CHARS));
      if (skills.length >= PROJECT_SKILL_LIMIT) break;
    }
    return skills;
  }

  private normalizeCustomFields(
    value: unknown,
  ): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value
      .map((raw, index) => ({ row: this.asRecord(raw), index }))
      .filter(
        (item): item is { row: Record<string, unknown>; index: number } =>
          !!item.row,
      )
      .sort((a, b) => {
        const aPosition = this.readNumber(a.row.position) ?? a.index;
        const bPosition = this.readNumber(b.row.position) ?? b.index;
        return aPosition - bPosition || a.index - b.index;
      })
      .flatMap(({ row, index }) => {
        const key = this.readTrimmedString(row.key);
        if (!key) return [];
        const valueText = this.readString(row.value) ?? '';
        return [
          {
            key: truncatePromptText(key, CUSTOM_FIELD_KEY_MAX_CHARS),
            value: htmlToText(valueText, CUSTOM_FIELD_VALUE_MAX_CHARS),
            position: this.readNumber(row.position) ?? index,
          },
        ];
      })
      .slice(0, CUSTOM_FIELD_LIMIT);
  }

  private normalizeCapabilities(value: unknown): Record<string, unknown> {
    const source = this.asRecord(value);
    if (!source) return {};

    const normalized: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(source)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, CAPABILITY_LIMIT)) {
      const key = truncatePromptText(rawKey.trim(), CAPABILITY_KEY_MAX_CHARS);
      if (!key) continue;

      if (typeof rawValue === 'boolean') {
        normalized[key] = rawValue;
      } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        normalized[key] = rawValue;
      } else if (typeof rawValue === 'string') {
        normalized[key] = truncatePromptText(
          rawValue.trim(),
          CAPABILITY_VALUE_MAX_CHARS,
        );
      } else if (rawValue !== null && rawValue !== undefined) {
        const serialized = JSON.stringify(rawValue);
        if (serialized) {
          normalized[key] = truncatePromptText(
            serialized,
            CAPABILITY_VALUE_MAX_CHARS,
          );
        }
      }
    }
    return normalized;
  }

  private emptyProjectContext(): RoadmapAiProjectContextDto {
    return {
      project: null,
      brief_excerpt: null,
      has_full_brief: false,
      custom_field_keys: [],
      members: [],
      teams: [],
      resource_summary: { count: 0, top_titles: [] },
      meeting_summary: { upcoming_count: 0, next: null },
    };
  }

  private noProject(): RoadmapAiNoProjectResponseDto {
    return { error: { code: 'NO_PROJECT' } };
  }

  private throwOnQueryError(error: { message?: string } | null): void {
    if (error) throw new Error(error.message ?? 'Database query failed');
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    return value as Record<string, unknown>;
  }

  private asSingleRecord(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) return this.asRecord(value[0]);
    return this.asRecord(value);
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private readTrimmedString(value: unknown): string | null {
    const result = this.readString(value)?.trim();
    return result ? result : null;
  }

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private truncatedString(value: unknown, maxChars: number): string | null {
    const text = this.readTrimmedString(value);
    return text ? truncatePromptText(text, maxChars) : null;
  }
}

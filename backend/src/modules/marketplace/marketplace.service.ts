import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import {
  buildMarketplaceFreelancersCacheKey,
  REDIS_CACHE_KEYS,
} from '../../common/cache/redis-cache.keys';
import { RedisCacheInvalidationService } from '../../common/cache/redis-cache-invalidation.service';
import {
  InviteFreelancerDto,
  MarketplaceQueryDto,
  RespondInviteDto,
} from './dto/marketplace.dto';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';

export interface MarketplaceFreelancerCard {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  headline: string | null;
  is_email_verified: boolean;
  avg_rating: number;
  availability: string;
  hourly_rate: number | null;
  currency: string;
  specialization: string | null;
  skills: Array<{ id: string; name: string; slug: string }>;
}

export interface MarketplaceInviteItem {
  id: string;
  project_id: string;
  invited_by: string;
  invitee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  message: string | null;
  created_at: string;
  updated_at: string;
  project: {
    id: string;
    title: string;
    status: string;
  } | null;
  inviter: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly notificationsService: NotificationsService,
    private readonly authorization: ProjectAuthorizationService,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  private async emitNotification(
    payload: Parameters<NotificationsService['createNotification']>[0],
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification(payload);
    } catch {
      return;
    }
  }

  private async ensureConsultant(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, is_consultant_verified')
      .eq('id', userId)
      .single();

    if (error || !data || !data.is_consultant_verified) {
      throw new ForbiddenException('Consultant access required');
    }
  }

  async getFreelancers(
    userId: string,
    query: MarketplaceQueryDto,
    options?: CacheReadOptions,
  ): Promise<MarketplaceFreelancerCard[]> {
    await this.ensureConsultant(userId);

    const cacheKey = buildMarketplaceFreelancersCacheKey(query);
    return this.cache.rememberJson(
      cacheKey,
      this.cache.getAuthTtlSeconds(),
      async () => {
        let profilesQuery = this.supabase
          .from('profiles')
          .select('id, display_name, avatar_url, headline, is_email_verified')
          .eq('is_public', true)
          .eq('active_persona', 'freelancer');

        if (query.search) {
          const escaped = query.search.replace(/[%_]/g, '');
          profilesQuery = profilesQuery.or(
            `display_name.ilike.%${escaped}%,headline.ilike.%${escaped}%`,
          );
        }

        const { data: profiles, error: profilesError } = await profilesQuery;

        if (profilesError) {
          throw new BadRequestException(profilesError.message);
        }

        if (!profiles?.length) return [];

        const userIds = profiles.map((p) => p.id);

        const [rateRes, statsRes, specsRes, skillsRes] = await Promise.all([
          this.supabase
            .from('user_rate_settings')
            .select('user_id, availability, hourly_rate, currency')
            .in('user_id', userIds),
          this.supabase
            .from('user_stats')
            .select('user_id, avg_rating')
            .in('user_id', userIds),
          this.supabase
            .from('user_specializations')
            .select('user_id, category')
            .in('user_id', userIds),
          this.supabase
            .from('user_skills')
            .select('user_id, skill:skills(id, name, slug)')
            .in('user_id', userIds),
        ]);

        const rateByUser = new Map(
          (rateRes.data || []).map((row) => [row.user_id, row]),
        );
        const statsByUser = new Map(
          (statsRes.data || []).map((row) => [row.user_id, row]),
        );

        const specsByUser = new Map<string, string[]>();
        for (const row of specsRes.data || []) {
          const existing = specsByUser.get(row.user_id) || [];
          existing.push(row.category);
          specsByUser.set(row.user_id, existing);
        }

        const skillsByUser = new Map<
          string,
          Array<{ id: string; name: string; slug: string }>
        >();
        for (const row of skillsRes.data || []) {
          const relation = (row.skill || []) as Array<{
            id: string;
            name: string;
            slug: string;
          }>;
          const skill = relation[0];
          if (!skill) continue;
          const existing = skillsByUser.get(row.user_id) || [];
          existing.push(skill);
          skillsByUser.set(row.user_id, existing);
        }

        let cards: MarketplaceFreelancerCard[] = profiles.map((profile) => {
          const rate = rateByUser.get(profile.id);
          const stats = statsByUser.get(profile.id);
          const specializations = specsByUser.get(profile.id) || [];
          const skills = skillsByUser.get(profile.id) || [];

          return {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
            headline: profile.headline,
            is_email_verified: Boolean(profile.is_email_verified),
            avg_rating: Number(stats?.avg_rating || 0),
            availability: String(rate?.availability || 'unavailable'),
            hourly_rate: rate?.hourly_rate ?? null,
            currency: String(rate?.currency || 'USD'),
            specialization: specializations[0] || null,
            skills,
          };
        });

        if (query.availability) {
          cards = cards.filter(
            (card) => card.availability === query.availability,
          );
        }

        if (query.specialization) {
          const target = query.specialization.toLowerCase();
          cards = cards.filter(
            (card) => (card.specialization || '').toLowerCase() === target,
          );
        }

        if (query.skill) {
          const target = query.skill.toLowerCase();
          cards = cards.filter((card) =>
            card.skills.some(
              (skill) =>
                skill.name.toLowerCase().includes(target) ||
                skill.slug.toLowerCase().includes(target),
            ),
          );
        }

        const sortMode = query.sort || 'rating_desc';
        if (sortMode === 'rate_asc') {
          cards.sort((a, b) => (a.hourly_rate || 0) - (b.hourly_rate || 0));
        } else if (sortMode === 'rate_desc') {
          cards.sort((a, b) => (b.hourly_rate || 0) - (a.hourly_rate || 0));
        } else {
          cards.sort((a, b) => b.avg_rating - a.avg_rating);
        }

        return cards;
      },
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.marketplaceFreelancersIndex,
        indexTtlSeconds: this.cache.getMarketplaceIndexTtlSeconds(),
      },
    );
  }

  async goLive(userId: string): Promise<{ is_public: boolean }> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ is_public: true, active_persona: 'freelancer' })
      .eq('id', userId)
      .select('is_public')
      .single();

    if (error || !data) {
      throw new BadRequestException(error?.message || 'Failed to go live');
    }

    await this.emitNotification({
      user_id: userId,
      type_name: 'marketplace_profile_live',
      actor_id: userId,
      content: {
        message: 'Your freelancer profile is now live in the marketplace.',
      },
      link_url: `/profile/${userId}`,
    });

    await this.cacheInvalidation.invalidateDiscoveryCaches(userId);
    return { is_public: data.is_public as boolean };
  }

  async inviteFreelancer(
    userId: string,
    dto: InviteFreelancerDto,
  ): Promise<{ id: string; status: string }> {
    await this.ensureConsultant(userId);

    if (dto.inviteeId === userId) {
      throw new BadRequestException('You cannot invite yourself.');
    }

    const { data: project, error: projectError } = await this.supabase
      .from('projects')
      .select('id, consultant_id')
      .eq('id', dto.projectId)
      .single();

    if (projectError || !project) {
      throw new BadRequestException('Project not found.');
    }

    // Anyone with admin+ role on the project can send marketplace invites.
    // Replaces the legacy `project.consultant_id === userId` check, which
    // tied invite authority to the consultant_id column. Personal-workspace
    // owners (no consultant assigned) and project admins can both invite.
    // The caller still must hold the consultant capability flag (enforced
    // above by ensureConsultant) to be allowed to *find* freelancers in the
    // marketplace bench in the first place.
    await this.authorization.assertRole(userId, dto.projectId, 'admin');

    const { data: invitee, error: inviteeError } = await this.supabase
      .from('profiles')
      .select('id, is_public')
      .eq('id', dto.inviteeId)
      .single();

    if (inviteeError || !invitee || !invitee.is_public) {
      throw new BadRequestException('Invitee is not available in marketplace.');
    }

    const { data, error } = await this.supabase
      .from('project_invites')
      .upsert(
        {
          project_id: dto.projectId,
          invited_by: userId,
          invitee_id: dto.inviteeId,
          message: dto.message || null,
          status: 'pending',
        },
        { onConflict: 'project_id,invitee_id' },
      )
      .select('id, status')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create invite',
      );
    }

    await this.emitNotification({
      user_id: dto.inviteeId,
      project_id: dto.projectId,
      type_name: 'project_invite_received',
      actor_id: userId,
      content: {
        invite_id: data.id,
        message: dto.message || null,
      },
      link_url: '/freelancer/marketplace/invites',
    });

    return {
      id: data.id as string,
      status: data.status as string,
    };
  }

  async getMyInvites(userId: string): Promise<MarketplaceInviteItem[]> {
    const { data: invites, error: invitesError } = await this.supabase
      .from('project_invites')
      .select(
        'id, project_id, invited_by, invitee_id, status, message, created_at, updated_at',
      )
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false });

    if (invitesError) {
      throw new BadRequestException(invitesError.message);
    }

    if (!invites?.length) {
      return [];
    }

    const projectIds = [...new Set(invites.map((invite) => invite.project_id))];
    const inviterIds = [...new Set(invites.map((invite) => invite.invited_by))];

    const [projectsRes, invitersRes] = await Promise.all([
      this.supabase
        .from('projects')
        .select('id, title, status')
        .in('id', projectIds),
      this.supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', inviterIds),
    ]);

    const projectById = new Map(
      (projectsRes.data || []).map((project) => [
        project.id as string,
        project,
      ]),
    );
    const inviterById = new Map(
      (invitersRes.data || []).map((inviter) => [
        inviter.id as string,
        inviter,
      ]),
    );

    return invites.map((invite) => ({
      id: invite.id as string,
      project_id: invite.project_id as string,
      invited_by: invite.invited_by as string,
      invitee_id: invite.invitee_id as string,
      status: invite.status as 'pending' | 'accepted' | 'declined',
      message: (invite.message as string | null) || null,
      created_at: invite.created_at as string,
      updated_at: invite.updated_at as string,
      project: (() => {
        const project = projectById.get(invite.project_id as string);
        if (!project) return null;
        return {
          id: project.id as string,
          title: (project.title as string) || 'Untitled Project',
          status: (project.status as string) || 'unknown',
        };
      })(),
      inviter: (() => {
        const inviter = inviterById.get(invite.invited_by as string);
        if (!inviter) return null;
        return {
          id: inviter.id as string,
          display_name: (inviter.display_name as string | null) || null,
          avatar_url: (inviter.avatar_url as string | null) || null,
        };
      })(),
    }));
  }

  async respondInvite(
    userId: string,
    inviteId: string,
    dto: RespondInviteDto,
  ): Promise<{ id: string; status: string }> {
    const { data: invite, error: inviteError } = await this.supabase
      .from('project_invites')
      .select('id, project_id, invitee_id, invited_by, status')
      .eq('id', inviteId)
      .single();

    if (inviteError || !invite) {
      throw new BadRequestException('Invite not found.');
    }

    if (invite.invitee_id !== userId) {
      throw new ForbiddenException(
        'Only the invitee can respond to this invite.',
      );
    }

    if (invite.status !== 'pending') {
      throw new BadRequestException('Invite has already been responded to.');
    }

    const { data: updatedInvite, error: updateError } = await this.supabase
      .from('project_invites')
      .update({ status: dto.status, updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .select('id, status')
      .single();

    if (updateError || !updatedInvite) {
      throw new BadRequestException(
        updateError?.message || 'Failed to update invite.',
      );
    }

    if (dto.status === 'accepted') {
      // Slice 3b: marketplace accepts grant a project_shares row directly.
      // Editor is the default for marketplace freelancer invites — they
      // need to edit deliverables but not manage members or billing.
      try {
        await this.authorization.grant({
          projectId: invite.project_id as string,
          userId,
          role: 'editor',
          origin: 'invited',
          grantedBy: invite.invited_by as string | null,
        });
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error
            ? err.message
            : 'Failed to grant project access to invitee.',
        );
      }
    }

    await this.emitNotification({
      user_id: invite.invited_by as string,
      project_id: invite.project_id as string,
      type_name: 'project_invite_responded',
      actor_id: userId,
      content: {
        invite_id: inviteId,
        status: dto.status,
      },
      link_url: '/consultant/marketplace',
    });

    await this.cacheInvalidation.invalidateAllDashboardCache();
    return {
      id: updatedInvite.id as string,
      status: updatedInvite.status as string,
    };
  }
}

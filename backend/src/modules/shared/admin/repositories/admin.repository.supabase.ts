import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { AdminRepository } from './admin.repository.interface';
import { synthesizeProjectConsultant } from '../../../execution/projects/repositories/project-payload.mapper';

@Injectable()
export class SupabaseAdminRepository implements AdminRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getAdminProfile(userId: string) {
    const { data } = await this.supabase
      .from('admin_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();
    return data;
  }

  async listApplications(filters: { status?: string }) {
    let q = this.supabase
      .from('consultant_applications')
      .select(
        '*, applicant:profiles!consultant_applications_user_id_fkey(id, display_name, first_name, last_name, avatar_url, email, headline, is_consultant_verified)',
      )
      .order('created_at', { ascending: false });
    if (filters.status) q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async getApplicationDetail(id: string) {
    const { data: app } = await this.supabase
      .from('consultant_applications')
      .select('*')
      .eq('id', id)
      .single();
    if (!app) throw new NotFoundException('Application not found');

    const userId = (app as Record<string, string>).user_id;

    const [
      profile,
      skills,
      languages,
      educations,
      certifications,
      licenses,
      experiences,
      portfolios,
      specializations,
      identityDocs,
      rateSettings,
    ] = await Promise.all([
      this.supabase.from('profiles').select('*').eq('id', userId).single(),
      this.supabase
        .from('user_skills')
        .select('*, skill:skills(*)')
        .eq('user_id', userId),
      this.supabase
        .from('user_languages')
        .select('*, language:languages(*)')
        .eq('user_id', userId),
      this.supabase.from('user_educations').select('*').eq('user_id', userId),
      this.supabase
        .from('user_certifications')
        .select('*')
        .eq('user_id', userId),
      this.supabase.from('user_licenses').select('*').eq('user_id', userId),
      this.supabase.from('user_experiences').select('*').eq('user_id', userId),
      this.supabase.from('user_portfolios').select('*').eq('user_id', userId),
      this.supabase
        .from('user_specializations')
        .select('*')
        .eq('user_id', userId),
      this.supabase
        .from('user_identity_documents')
        .select('*')
        .eq('user_id', userId),
      this.supabase
        .from('user_rate_settings')
        .select('*')
        .eq('user_id', userId)
        .single(),
    ]);

    const profileData =
      (profile.data as Record<string, unknown> | null) ?? null;

    return {
      ...(app as Record<string, unknown>),
      applicant: profileData
        ? {
            id: profileData.id,
            display_name: profileData.display_name,
            first_name: profileData.first_name,
            last_name: profileData.last_name,
            email: profileData.email,
            avatar_url: profileData.avatar_url,
            headline: profileData.headline,
            is_consultant_verified: Boolean(profileData.is_consultant_verified),
          }
        : undefined,
      vetting: {
        skills: skills.data || [],
        languages: languages.data || [],
        educations: educations.data || [],
        certifications: certifications.data || [],
        licenses: licenses.data || [],
        experiences: experiences.data || [],
        portfolios: portfolios.data || [],
        specializations: specializations.data || [],
        identity_documents: identityDocs.data || [],
        rate_settings: rateSettings.data || null,
      },
    };
  }

  async getApplicationUserId(id: string): Promise<string> {
    const result = (await this.supabase
      .from('consultant_applications')
      .select('user_id')
      .eq('id', id)
      .single()) as unknown as {
      data: { user_id: string } | null;
      error: { message: string } | null;
    };
    const { data, error } = result;
    if (error || !data?.user_id) {
      throw new NotFoundException('Application not found');
    }
    return data.user_id as string;
  }

  async approveApplication(id: string) {
    const { data: app } = await this.supabase
      .from('consultant_applications')
      .select('user_id')
      .eq('id', id)
      .single();
    if (!app) throw new NotFoundException('Application not found');

    const profileUpdate = (await this.supabase
      .from('profiles')
      .update({ is_consultant_verified: true })
      .eq('id', (app as Record<string, string>).user_id)) as unknown as {
      error: { message: string } | null;
    };
    const { error: profileError } = profileUpdate;
    if (profileError) throw new Error(profileError.message);

    const { data, error } = await this.supabase
      .from('consultant_applications')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async rejectApplication(id: string, reason?: string) {
    const { data, error } = await this.supabase
      .from('consultant_applications')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listAdmins() {
    const { data } = await this.supabase
      .from('admin_profiles')
      .select('*, user:profiles(id, display_name, avatar_url, email)')
      .eq('is_active', true);
    return data || [];
  }

  async grantAdmin(
    userId: string,
    data: { access_level?: string; department?: string },
  ) {
    const { data: row, error } = await this.supabase
      .from('admin_profiles')
      .upsert(
        { user_id: userId, is_active: true, ...data },
        { onConflict: 'user_id' },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  }

  async revokeAdmin(userId: string): Promise<void> {
    await this.supabase
      .from('admin_profiles')
      .update({ is_active: false })
      .eq('user_id', userId);
  }

  async getMatchCandidates(filters: {
    project_id?: string;
    q?: string;
    niche?: string;
    availability?: string;
    minRate?: number;
    maxRate?: number;
  }): Promise<unknown[]> {
    // Get project skills for scoring when a project is selected
    const { project_id, q, niche, availability, minRate, maxRate } = filters;

    let project: Record<string, unknown> | null = null;
    if (project_id) {
      const { data } = await this.supabase
        .from('projects')
        .select('skills')
        .eq('id', project_id)
        .single();
      project = (data as Record<string, unknown> | null) ?? null;
    }

    const projectSkills: string[] = Array.isArray(
      (project as Record<string, unknown>)?.skills,
    )
      ? ((project as Record<string, unknown[]>).skills as string[])
      : [];

    const { data: candidates } = await this.supabase
      .from('profiles')
      .select(
        `
        id, display_name, first_name, last_name, email, avatar_url, headline, country,
        is_consultant_verified,
        rate_settings:user_rate_settings(*),
        stats:user_stats(*),
        specializations:user_specializations(*),
        skills:user_skills(*, skill:skills(*))
      `,
      )
      .eq('is_consultant_verified', true);

    if (!candidates) return [];

    // Score candidates by skill overlap
    const normalizedQ = q?.trim().toLowerCase();

    const scoredCandidates = (candidates as Record<string, unknown>[]).map(
      (c) => {
        const candidateSkillNames: string[] = Array.isArray(c.skills)
          ? (c.skills as Record<string, unknown>[]).map((s) => {
              const skill = s.skill as Record<string, string> | undefined;
              return skill?.name?.toLowerCase() ?? '';
            })
          : [];

        const overlap = projectSkills.filter((ps) =>
          candidateSkillNames.includes(String(ps).toLowerCase()),
        ).length;

        return { ...c, match_score: overlap } as Record<string, unknown>;
      },
    );

    return scoredCandidates
      .filter((candidate) => {
        if (normalizedQ) {
          const displayName = String(
            candidate.display_name ?? '',
          ).toLowerCase();
          const firstName = String(candidate.first_name ?? '').toLowerCase();
          const lastName = String(candidate.last_name ?? '').toLowerCase();
          const email = String(candidate.email ?? '').toLowerCase();
          const headline = String(candidate.headline ?? '').toLowerCase();

          const matchesQ =
            displayName.includes(normalizedQ) ||
            `${firstName} ${lastName}`.trim().includes(normalizedQ) ||
            email.includes(normalizedQ) ||
            headline.includes(normalizedQ);

          if (!matchesQ) return false;
        }

        if (niche) {
          const hasNiche = Array.isArray(candidate.specializations)
            ? (candidate.specializations as Record<string, unknown>[]).some(
                (s) => String(s.category ?? '') === niche,
              )
            : false;

          if (!hasNiche) return false;
        }

        const rateSettings =
          (candidate.rate_settings as Record<string, unknown> | null) ?? null;

        if (availability) {
          const candidateAvailability = String(
            rateSettings?.availability ?? '',
          );
          if (candidateAvailability !== availability) return false;
        }

        const hourlyRate = Number(rateSettings?.hourly_rate ?? NaN);
        if (
          minRate != null &&
          Number.isFinite(hourlyRate) &&
          hourlyRate < minRate
        )
          return false;
        if (
          maxRate != null &&
          Number.isFinite(hourlyRate) &&
          hourlyRate > maxRate
        )
          return false;

        return true;
      })
      .sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0));
  }

  async assignConsultant(projectId: string) {
    const { data, error } = await this.supabase
      .from('projects')
      .update({ status: 'active' })
      .eq('id', projectId)
      .select(
        '*, owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url), members:project_access(user_id, origin, has_direct_grant, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, headline, email))',
      )
      .single();
    if (error || !data) throw new NotFoundException('Project not found');

    return synthesizeProjectConsultant(data as Record<string, unknown>);
  }

  async listProjects() {
    const { data } = await this.supabase
      .from('projects')
      .select(
        '*, owner:profiles!projects_owner_id_fkey(id, display_name, avatar_url), members:project_access(user_id, origin, has_direct_grant, granted_at, user:profiles!project_access_user_id_fkey(id, display_name, avatar_url, headline, email))',
      )
      .order('created_at', { ascending: false });
    const projects = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return projects.map((project) => synthesizeProjectConsultant(project));
  }

  async listUsers() {
    const { data } = await this.supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  }
}

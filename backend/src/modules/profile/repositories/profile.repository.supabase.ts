import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { FullProfile, ProfileRepository } from './profile.repository.interface';
import {
  Profile,
  Skill,
  Language,
  UserSkill,
  UserLanguage,
  UserEducation,
  UserCertification,
  UserExperience,
  UserPortfolio,
  UserLicense,
  UserSpecialization,
  UserRateSettings,
  UserStats,
  UserIdentityDocument,
} from '../../../common/entities';

@Injectable()
export class SupabaseProfileRepository implements ProfileRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getFullProfile(userId: string): Promise<FullProfile | null> {
    const [
      profileResult,
      skillsResult,
      languagesResult,
      educationsResult,
      certificationsResult,
      licensesResult,
      experiencesResult,
      portfoliosResult,
      statsResult,
      specializationsResult,
      rateSettingsResult,
      identityDocsResult,
      phoneVerificationResult,
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
      this.supabase
        .from('user_portfolios')
        .select('*')
        .eq('user_id', userId)
        .order('position'),
      this.supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single(),
      this.supabase
        .from('user_specializations')
        .select('*')
        .eq('user_id', userId),
      this.supabase
        .from('user_rate_settings')
        .select('*')
        .eq('user_id', userId)
        .single(),
      this.supabase
        .from('user_identity_documents')
        .select('*')
        .eq('user_id', userId),
      this.supabase
        .from('user_verifications')
        .select('status')
        .eq('user_id', userId)
        .eq('type', 'phone')
        .maybeSingle(),
    ]);

    if (!profileResult.data) return null;

    return {
      profile: profileResult.data as Profile,
      skills: (skillsResult.data || []) as UserSkill[],
      languages: (languagesResult.data || []) as UserLanguage[],
      educations: (educationsResult.data || []) as UserEducation[],
      certifications: (certificationsResult.data || []) as UserCertification[],
      licenses: (licensesResult.data || []) as UserLicense[],
      experiences: (experiencesResult.data || []) as UserExperience[],
      portfolios: (portfoliosResult.data || []) as UserPortfolio[],
      stats: (statsResult.data as UserStats) || null,
      specializations: (specializationsResult.data ||
        []) as UserSpecialization[],
      rate_settings: (rateSettingsResult.data as UserRateSettings) || null,
      identity_documents: (identityDocsResult.data ||
        []) as UserIdentityDocument[],
      is_phone_verified:
        (phoneVerificationResult.data as { status: string } | null)?.status ===
        'verified',
    };
  }

  async updateBasic(userId: string, data: Partial<Profile>): Promise<Profile> {
    const { data: updated, error } = await this.supabase
      .from('profiles')
      .update(data)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return updated as Profile;
  }

  async getAllSkills(): Promise<Skill[]> {
    const { data } = await this.supabase
      .from('skills')
      .select('*')
      .order('name');
    return (data || []) as Skill[];
  }

  async getAllLanguages(): Promise<Language[]> {
    const { data } = await this.supabase
      .from('languages')
      .select('*')
      .order('name');
    return (data || []) as Language[];
  }

  async replaceUserSkills(
    userId: string,
    skills: {
      skill_id: string;
      proficiency_level?: string;
      years_experience?: number;
    }[],
  ): Promise<UserSkill[]> {
    await this.supabase.from('user_skills').delete().eq('user_id', userId);
    if (!skills.length) return [];
    const toInsert = skills.map((s) => ({ user_id: userId, ...s }));
    const { data, error } = await this.supabase
      .from('user_skills')
      .insert(toInsert)
      .select('*, skill:skills(*)');
    if (error) throw new Error(error.message);
    return (data || []) as UserSkill[];
  }

  async addLanguage(
    userId: string,
    data: { language_id: string; fluency_level: string },
  ): Promise<UserLanguage> {
    const { data: row, error } = await this.supabase
      .from('user_languages')
      .insert({ user_id: userId, ...data })
      .select('*, language:languages(*)')
      .single();
    if (error) throw new Error(error.message);
    return row as UserLanguage;
  }

  async updateLanguage(
    id: string,
    userId: string,
    data: { fluency_level?: string },
  ): Promise<UserLanguage> {
    const { data: row, error } = await this.supabase
      .from('user_languages')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*, language:languages(*)')
      .single();
    if (error || !row) throw new NotFoundException('Language record not found');
    return row as UserLanguage;
  }

  async deleteLanguage(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_languages')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addEducation(
    userId: string,
    data: Partial<UserEducation>,
  ): Promise<UserEducation> {
    const { data: row, error } = await this.supabase
      .from('user_educations')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserEducation;
  }

  async updateEducation(
    id: string,
    userId: string,
    data: Partial<UserEducation>,
  ): Promise<UserEducation> {
    const { data: row, error } = await this.supabase
      .from('user_educations')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row)
      throw new NotFoundException('Education record not found');
    return row as UserEducation;
  }

  async deleteEducation(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_educations')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addCertification(
    userId: string,
    data: Partial<UserCertification>,
  ): Promise<UserCertification> {
    const { data: row, error } = await this.supabase
      .from('user_certifications')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserCertification;
  }

  async updateCertification(
    id: string,
    userId: string,
    data: Partial<UserCertification>,
  ): Promise<UserCertification> {
    const { data: row, error } = await this.supabase
      .from('user_certifications')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row)
      throw new NotFoundException('Certification record not found');
    return row as UserCertification;
  }

  async deleteCertification(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_certifications')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addExperience(
    userId: string,
    data: Partial<UserExperience>,
  ): Promise<UserExperience> {
    const { data: row, error } = await this.supabase
      .from('user_experiences')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserExperience;
  }

  async updateExperience(
    id: string,
    userId: string,
    data: Partial<UserExperience>,
  ): Promise<UserExperience> {
    const { data: row, error } = await this.supabase
      .from('user_experiences')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row)
      throw new NotFoundException('Experience record not found');
    return row as UserExperience;
  }

  async deleteExperience(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_experiences')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addPortfolio(
    userId: string,
    data: Partial<UserPortfolio>,
  ): Promise<UserPortfolio> {
    const { data: row, error } = await this.supabase
      .from('user_portfolios')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserPortfolio;
  }

  async updatePortfolio(
    id: string,
    userId: string,
    data: Partial<UserPortfolio>,
  ): Promise<UserPortfolio> {
    const { data: row, error } = await this.supabase
      .from('user_portfolios')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row)
      throw new NotFoundException('Portfolio record not found');
    return row as UserPortfolio;
  }

  async deletePortfolio(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_portfolios')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addLicense(
    userId: string,
    data: Partial<UserLicense>,
  ): Promise<UserLicense> {
    const { data: row, error } = await this.supabase
      .from('user_licenses')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserLicense;
  }

  async updateLicense(
    id: string,
    userId: string,
    data: Partial<UserLicense>,
  ): Promise<UserLicense> {
    const { data: row, error } = await this.supabase
      .from('user_licenses')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row) throw new NotFoundException('License record not found');
    return row as UserLicense;
  }

  async deleteLicense(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_licenses')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async addSpecialization(
    userId: string,
    data: Partial<UserSpecialization>,
  ): Promise<UserSpecialization> {
    const { data: row, error } = await this.supabase
      .from('user_specializations')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserSpecialization;
  }

  async updateSpecialization(
    id: string,
    userId: string,
    data: Partial<UserSpecialization>,
  ): Promise<UserSpecialization> {
    const { data: row, error } = await this.supabase
      .from('user_specializations')
      .update(data)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error || !row)
      throw new NotFoundException('Specialization record not found');
    return row as UserSpecialization;
  }

  async deleteSpecialization(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_specializations')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async upsertRateSettings(
    userId: string,
    data: Partial<UserRateSettings>,
  ): Promise<UserRateSettings> {
    const { data: row, error } = await this.supabase
      .from('user_rate_settings')
      .upsert({ user_id: userId, ...data }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserRateSettings;
  }

  async addIdentityDocument(
    userId: string,
    data: Partial<UserIdentityDocument>,
  ): Promise<UserIdentityDocument> {
    const { data: row, error } = await this.supabase
      .from('user_identity_documents')
      .insert({ user_id: userId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as UserIdentityDocument;
  }

  async deleteIdentityDocument(id: string, userId: string): Promise<void> {
    await this.supabase
      .from('user_identity_documents')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  }

  async clearPhoneVerification(userId: string): Promise<void> {
    await this.supabase
      .from('user_verifications')
      .delete()
      .eq('user_id', userId)
      .eq('type', 'phone');
  }
}

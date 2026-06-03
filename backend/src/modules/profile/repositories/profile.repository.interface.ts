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

export interface FullProfile {
  profile: Profile;
  skills: UserSkill[];
  languages: UserLanguage[];
  educations: UserEducation[];
  certifications: UserCertification[];
  licenses: UserLicense[];
  experiences: UserExperience[];
  portfolios: UserPortfolio[];
  stats: UserStats | null;
  specializations: UserSpecialization[];
  rate_settings: UserRateSettings | null;
  identity_documents: UserIdentityDocument[];
  is_phone_verified: boolean;
}

export interface ProfileRepository {
  getFullProfile(userId: string): Promise<FullProfile | null>;
  updateBasic(userId: string, data: Partial<Profile>): Promise<Profile>;

  // Meta
  getAllSkills(): Promise<Skill[]>;
  getAllLanguages(): Promise<Language[]>;

  // Skills
  replaceUserSkills(
    userId: string,
    skills: {
      skill_id: string;
      proficiency_level?: string;
      years_experience?: number;
    }[],
  ): Promise<UserSkill[]>;

  // Languages
  addLanguage(
    userId: string,
    data: { language_id: string; fluency_level: string },
  ): Promise<UserLanguage>;
  updateLanguage(
    id: string,
    userId: string,
    data: { fluency_level?: string },
  ): Promise<UserLanguage>;
  deleteLanguage(id: string, userId: string): Promise<void>;

  // Educations
  addEducation(
    userId: string,
    data: Partial<UserEducation>,
  ): Promise<UserEducation>;
  updateEducation(
    id: string,
    userId: string,
    data: Partial<UserEducation>,
  ): Promise<UserEducation>;
  deleteEducation(id: string, userId: string): Promise<void>;

  // Certifications
  addCertification(
    userId: string,
    data: Partial<UserCertification>,
  ): Promise<UserCertification>;
  updateCertification(
    id: string,
    userId: string,
    data: Partial<UserCertification>,
  ): Promise<UserCertification>;
  deleteCertification(id: string, userId: string): Promise<void>;

  // Experiences
  addExperience(
    userId: string,
    data: Partial<UserExperience>,
  ): Promise<UserExperience>;
  updateExperience(
    id: string,
    userId: string,
    data: Partial<UserExperience>,
  ): Promise<UserExperience>;
  deleteExperience(id: string, userId: string): Promise<void>;

  // Portfolios
  addPortfolio(
    userId: string,
    data: Partial<UserPortfolio>,
  ): Promise<UserPortfolio>;
  updatePortfolio(
    id: string,
    userId: string,
    data: Partial<UserPortfolio>,
  ): Promise<UserPortfolio>;
  deletePortfolio(id: string, userId: string): Promise<void>;

  // Licenses
  addLicense(userId: string, data: Partial<UserLicense>): Promise<UserLicense>;
  updateLicense(
    id: string,
    userId: string,
    data: Partial<UserLicense>,
  ): Promise<UserLicense>;
  deleteLicense(id: string, userId: string): Promise<void>;

  // Specializations
  addSpecialization(
    userId: string,
    data: Partial<UserSpecialization>,
  ): Promise<UserSpecialization>;
  updateSpecialization(
    id: string,
    userId: string,
    data: Partial<UserSpecialization>,
  ): Promise<UserSpecialization>;
  deleteSpecialization(id: string, userId: string): Promise<void>;

  // Rate settings
  upsertRateSettings(
    userId: string,
    data: Partial<UserRateSettings>,
  ): Promise<UserRateSettings>;

  // Identity documents
  addIdentityDocument(
    userId: string,
    data: Partial<UserIdentityDocument>,
  ): Promise<UserIdentityDocument>;
  deleteIdentityDocument(id: string, userId: string): Promise<void>;

  // Phone verification
  clearPhoneVerification(userId: string): Promise<void>;
}

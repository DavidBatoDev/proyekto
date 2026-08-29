import { ConsultantApplication } from '../../../../common/entities';

export const APPLICATIONS_REPOSITORY = Symbol('APPLICATIONS_REPOSITORY');

export interface ApplicationDraftInput {
  linkedin_url?: string;
  /** Replace-set: when present, existing placements are replaced entirely. */
  placements?: Array<{
    subcategory_id: string;
    years_experience: number | null;
    is_primary: boolean;
    position: number;
  }>;
}

export interface ApplicationsRepository {
  findByUser(userId: string): Promise<ConsultantApplication | null>;
  upsert(
    userId: string,
    input: ApplicationDraftInput,
  ): Promise<ConsultantApplication>;
  /** draft | rejected -> submitted; clears review fields, stamps submitted_at. */
  submit(userId: string): Promise<ConsultantApplication>;
  /** Active admin user ids, for the submitted-application fan-out. */
  listActiveAdminUserIds(): Promise<string[]>;
}

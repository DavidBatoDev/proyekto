import { IsEmail, IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

/**
 * 'owner' is deliberately absent everywhere: ownership is implicit from the
 * book and can never be granted, mirroring the DB CHECK on finance_invites.
 */
export const GRANTABLE_FINANCE_ROLES = [
  'manager',
  'accountant',
  'viewer_client',
  'viewer',
] as const;
export type GrantableFinanceRole = (typeof GRANTABLE_FINANCE_ROLES)[number];

export class AddBookMemberDto {
  @IsUUID()
  user_id!: string;

  @IsIn(GRANTABLE_FINANCE_ROLES)
  finance_role!: GrantableFinanceRole;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

export class UpdateBookMemberDto {
  @IsOptional()
  @IsIn(GRANTABLE_FINANCE_ROLES)
  finance_role?: GrantableFinanceRole;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

export class CreateFinanceInviteDto {
  @IsEmail()
  email!: string;

  @IsIn(GRANTABLE_FINANCE_ROLES)
  finance_role!: GrantableFinanceRole;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, unknown>;
}

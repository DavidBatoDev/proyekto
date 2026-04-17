import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export type InvitationRoleType = 'consultant' | 'freelancer' | 'client';
export type InvitationRequestStatus = 'pending' | 'approved' | 'rejected';

export class CreateInvitationLinkDto {
  @IsIn(['consultant', 'freelancer', 'client'])
  role_type: InvitationRoleType;

  @IsOptional()
  @IsString()
  expires_at?: string;
}

export class SubmitInvitationRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReviewInvitationRequestDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;
}

export class ListInvitationRequestsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: InvitationRequestStatus;
}

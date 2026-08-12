import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class MarketplaceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  skill?: string;

  @IsOptional()
  @IsIn(['available', 'partially_available', 'unavailable'])
  availability?: 'available' | 'partially_available' | 'unavailable';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialization?: string;

  @IsOptional()
  @IsIn(['rating_desc', 'rate_asc', 'rate_desc'])
  sort?: 'rating_desc' | 'rate_asc' | 'rate_desc';
}

export class InviteFreelancerDto {
  @IsUUID()
  projectId: string;

  @IsUUID()
  inviteeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  message?: string;
}

export class RespondInviteDto {
  @IsIn(['accepted', 'declined'])
  status: 'accepted' | 'declined';
}

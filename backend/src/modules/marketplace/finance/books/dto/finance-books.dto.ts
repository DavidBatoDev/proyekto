import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreatePersonalBookDto {
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class CreateTeamBookDto {
  @IsUUID()
  team_id!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  project_ids?: string[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class AddProjectBookDto {
  @IsUUID()
  project_id!: string;
}

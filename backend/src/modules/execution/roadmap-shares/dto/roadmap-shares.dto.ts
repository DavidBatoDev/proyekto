import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateShareDto {
  @IsEnum(['viewer', 'commenter', 'editor'])
  @IsOptional()
  permission_level?: string;
  @IsISO8601() @IsOptional() expires_at?: string;
}

export class AddShareCommentDto {
  @IsString() @MaxLength(5000) content: string;
  @IsString() @IsOptional() commenter_name?: string;
}

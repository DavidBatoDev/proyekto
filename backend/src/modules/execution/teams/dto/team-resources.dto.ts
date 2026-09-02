import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  RESOURCE_FOLDER_COLORS,
  RESOURCE_FOLDER_ICONS,
} from '../../../../common/resources/folder-tokens';

/**
 * Team resources mirror project resources field for field, so the validators
 * here are the same ones `project.dto.ts` uses. Kept in their own file rather
 * than appended to `teams.dto.ts`, which already covers five unrelated concerns
 * across ~480 lines.
 */

class TeamResourceReorderItemDto {
  @IsUUID()
  id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  position!: number;
}

export class CreateTeamResourceFolderDto {
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, { message: 'Folder name is required.' })
  name!: string;

  @IsOptional()
  @IsIn(RESOURCE_FOLDER_ICONS)
  icon?: string;

  @IsOptional()
  @IsIn(RESOURCE_FOLDER_COLORS)
  color?: string;
}

export class UpdateTeamResourceFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/, { message: 'Folder name is required.' })
  name?: string;

  @IsOptional()
  @IsIn(RESOURCE_FOLDER_ICONS)
  icon?: string;

  @IsOptional()
  @IsIn(RESOURCE_FOLDER_COLORS)
  color?: string;
}

export class ReorderTeamResourceFoldersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamResourceReorderItemDto)
  items!: TeamResourceReorderItemDto[];
}

export class CreateTeamResourceLinkDto {
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'Link title is required.' })
  title!: string;

  @IsString()
  @MaxLength(2048)
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    require_host: true,
    protocols: ['http', 'https'],
  })
  @Matches(/^https?:\/\//i, { message: 'Link URL must start with http(s)://' })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * `@ValidateIf` rather than `@IsOptional` on purpose: an explicit `null` must
   * survive validation, because null is how the client says "move this link to
   * uncategorized". The service distinguishes an absent key from a present null
   * with `hasOwnProperty`, so `@IsOptional` — which treats null as absent —
   * would quietly turn a move into a no-op.
   */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;
}

export class UpdateTeamResourceLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: 'Link title is required.' })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    require_host: true,
    protocols: ['http', 'https'],
  })
  @Matches(/^https?:\/\//i, { message: 'Link URL must start with http(s)://' })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** See the note on CreateTeamResourceLinkDto.folder_id. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;
}

export class ReorderTeamResourceLinksDto {
  /** Which container is being reordered. Absent or null means uncategorized. */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID()
  folder_id?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamResourceReorderItemDto)
  items!: TeamResourceReorderItemDto[];
}

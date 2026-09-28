import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** The phrase the user types to confirm. Matched case-insensitively. */
export const DELETE_CONFIRMATION_PHRASE = 'delete my account';

/**
 * What to do with one container the user solely owns and other people are in.
 *
 * `kind` is part of the identity, not decoration: workspaces and teams are
 * separate id spaces, and `delete_account` matches on the pair.
 */
export class ContainerResolutionDto {
  @IsIn(['workspace', 'team'])
  kind: 'workspace' | 'team';

  @IsUUID()
  id: string;

  @IsIn(['transfer', 'delete'])
  action: 'transfer' | 'delete';

  @ValidateIf((o: ContainerResolutionDto) => o.action === 'transfer')
  @IsUUID()
  new_owner_id?: string;
}

export class DeleteAccountDto {
  /**
   * Validated server-side as well as in the UI. A typed phrase is a speed bump
   * against a mis-click, not an authorization check -- that is what the
   * credential below is for.
   */
  @IsString()
  @MaxLength(64)
  confirmation: string;

  /**
   * Exactly one of `password` / `code` is required. Enforced in the service
   * rather than the DTO so the error can say which one this account needs;
   * an account signed up through Google has no password to give.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  /**
   * One entry per container the preflight listed under `decisions`. The RPC
   * re-derives that list inside its lock and rejects anything that does not
   * match, so this is a proposal rather than a source of truth.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ContainerResolutionDto)
  containers?: ContainerResolutionDto[];
}

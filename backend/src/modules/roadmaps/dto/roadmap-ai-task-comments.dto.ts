import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Batch comment request from the AI agent: the same comment posted to each
 * task. Capped at 25 ids per call — the agent splits larger sets, so one
 * request never fans out into an unbounded notification/indexing burst.
 */
export class RoadmapAiTaskCommentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsUUID(undefined, { each: true })
  task_ids: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}

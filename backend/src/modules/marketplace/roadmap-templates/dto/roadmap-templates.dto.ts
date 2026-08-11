import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RoadmapTemplateCatalogQueryDto {
  @IsString() @IsOptional() @MaxLength(200) search?: string;
  @IsString() @IsOptional() @MaxLength(80) category?: string;
  @IsString() @IsOptional() @MaxLength(500) tags?: string;
  @IsIn(['beginner', 'intermediate', 'advanced'])
  @IsOptional()
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  @IsIn(['long_term', 'short_learning'])
  @IsOptional()
  schedule_kind?: 'long_term' | 'short_learning';
  @IsIn(['featured', 'newest', 'popular', 'rating'])
  @IsOptional()
  sort: 'featured' | 'newest' | 'popular' | 'rating' = 'featured';
  @IsString() @IsOptional() cursor?: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit = 20;
}

export class InstantiateRoadmapTemplateDto {
  @IsUUID() @IsOptional() project_id?: string;
  @IsDateString() start_date: string;
  @IsUUID() idempotency_key: string;
  @IsIn(['landing', 'marketplace', 'roadmap_create', 'consultant'])
  @IsOptional()
  source_surface: 'landing' | 'marketplace' | 'roadmap_create' | 'consultant' =
    'marketplace';
}

export class RecordRoadmapTemplateViewDto {
  @IsString() @MinLength(16) @MaxLength(200) visitor_key: string;
}

export class RateRoadmapTemplateDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
  @IsString() @IsOptional() @MaxLength(2000) review?: string;
}

export class ReportRoadmapTemplateDto {
  @IsIn(['copyright', 'unsafe', 'misleading', 'spam', 'other'])
  reason: 'copyright' | 'unsafe' | 'misleading' | 'spam' | 'other';
  @IsString() @MinLength(10) @MaxLength(2000) details: string;
}

export class CreateRoadmapTemplateFromRoadmapDto {
  @IsString() @MinLength(3) @MaxLength(200) title: string;
  @IsString() @MinLength(20) @MaxLength(1200) summary: string;
  @IsString() @IsNotEmpty() @MaxLength(80) category: string;
  @IsString() @IsOptional() @MaxLength(500) tags?: string;
  @IsString() @IsNotEmpty() preview_url: string;
  @IsIn(['beginner', 'intermediate', 'advanced']) difficulty:
    | 'beginner'
    | 'intermediate'
    | 'advanced';
  @IsIn(['long_term', 'short_learning']) schedule_kind:
    | 'long_term'
    | 'short_learning';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  estimated_duration_days: number;
  @IsBoolean() rights_attested: boolean;
  @IsUrl({ require_protocol: true }) @IsOptional() attribution_url?: string;
}

export class UpdateRoadmapTemplateDto {
  @IsString() @MinLength(3) @MaxLength(200) @IsOptional() title?: string;
  @IsString() @MinLength(20) @MaxLength(1200) @IsOptional() summary?: string;
  @IsString() @MaxLength(80) @IsOptional() category?: string;
  @IsString() @MaxLength(500) @IsOptional() tags?: string;
  @IsString() @IsOptional() preview_url?: string;
  @IsIn(['beginner', 'intermediate', 'advanced'])
  @IsOptional()
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  @IsIn(['long_term', 'short_learning'])
  @IsOptional()
  schedule_kind?: 'long_term' | 'short_learning';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  estimated_duration_days?: number;
  @IsUrl({ require_protocol: true }) @IsOptional() attribution_url?: string;
}

export class CreateRoadmapTemplateRevisionDto {
  @IsUUID() @IsOptional() roadmap_id?: string;
  @IsIn(['long_term', 'short_learning'])
  @IsOptional()
  schedule_kind?: 'long_term' | 'short_learning';
}

export class ModerateRoadmapTemplateDto {
  @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class FeatureRoadmapTemplateDto {
  @IsBoolean() is_featured: boolean;
}

export class ResolveRoadmapTemplateReportDto {
  @IsIn(['reviewing', 'resolved', 'dismissed'])
  status: 'reviewing' | 'resolved' | 'dismissed';
  @IsString() @MinLength(3) @MaxLength(2000) moderation_note: string;
}

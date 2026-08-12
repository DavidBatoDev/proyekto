import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const APPEARANCE_THEME_IDS = [
  'light',
  'classic-dark',
  'magic-blue',
  'dark',
  'custom',
] as const;

export type AppearanceThemeId = (typeof APPEARANCE_THEME_IDS)[number];

export interface AppearancePreferences {
  version: 1;
  theme: AppearanceThemeId;
  custom: {
    accent: string;
    background: string;
    contrast: number;
    sidebar: {
      enabled: boolean;
      accent: string;
      background: string;
      contrast: number;
    };
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

class CustomSidebarThemeDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(HEX_COLOR)
  accent: string;

  @IsString()
  @Matches(HEX_COLOR)
  background: string;

  @IsInt()
  @Min(0)
  @Max(100)
  contrast: number;
}

class CustomThemeDto {
  @IsString()
  @Matches(HEX_COLOR)
  accent: string;

  @IsString()
  @Matches(HEX_COLOR)
  background: string;

  @IsInt()
  @Min(0)
  @Max(100)
  contrast: number;

  @ValidateNested()
  @Type(() => CustomSidebarThemeDto)
  sidebar: CustomSidebarThemeDto;
}

export class UpdateAppearancePreferencesDto {
  @IsIn([1])
  version: 1;

  @IsIn(APPEARANCE_THEME_IDS)
  theme: AppearanceThemeId;

  @ValidateNested()
  @Type(() => CustomThemeDto)
  custom: CustomThemeDto;
}

export function normalizeAppearancePreferences(
  dto: UpdateAppearancePreferencesDto,
): AppearancePreferences {
  return {
    version: 1,
    theme: dto.theme,
    custom: {
      accent: dto.custom.accent.toUpperCase(),
      background: dto.custom.background.toUpperCase(),
      contrast: dto.custom.contrast,
      sidebar: {
        enabled: dto.custom.sidebar.enabled,
        accent: dto.custom.sidebar.accent.toUpperCase(),
        background: dto.custom.sidebar.background.toUpperCase(),
        contrast: dto.custom.sidebar.contrast,
      },
    },
  };
}

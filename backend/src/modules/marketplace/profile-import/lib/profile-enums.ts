/**
 * The enum vocabularies shared by the parser, the sanitizer and the DTO.
 *
 * They live here rather than in the DTO so the pure `lib/` modules stay free of
 * class-validator decorators -- importing the DTO from a plain function pulls
 * in reflect-metadata and makes the layout code impossible to unit-test without
 * booting Nest.
 *
 * Values mirror the Postgres enums `proficiency_level` and `fluency_level`.
 */
export const PROFICIENCY_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
  'expert',
] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export const FLUENCY_LEVELS = [
  'basic',
  'conversational',
  'fluent',
  'native',
] as const;
export type FluencyLevel = (typeof FLUENCY_LEVELS)[number];

import type { ImportedProfileDto } from '../dto/imported-profile.dto';
import { FLUENCY_LEVELS, PROFICIENCY_LEVELS } from './profile-enums';

/**
 * Bounds whatever the model returned before it reaches a DTO or the database.
 *
 * Mirrors the defensive layer in RoadmapMetadataGeneratorService: `json_object`
 * mode guarantees the response parses, not that it is sane. Anything
 * non-conforming is dropped rather than thrown, because the caller's contract
 * is to degrade to manual entry instead of failing onboarding.
 *
 * The caps also bound prompt-injection damage: a résumé that tries to talk to
 * the model still cannot produce a 5,000-item array or a megabyte of bio.
 */

const CAPS = {
  skills: 30,
  languages: 10,
  experiences: 25,
  educations: 15,
  certifications: 25,
  links: 10,
} as const;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.slice(0, max);
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (
    year < 1900 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }
  return `${y}-${m}-${d}`;
}

function year(value: unknown): number | undefined {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(n) || n < 1900 || n > 2100) return undefined;
  return n;
}

function array(value: unknown, cap: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, cap) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sanitizeImportedProfile(raw: unknown): ImportedProfileDto {
  const root = record(raw);
  const basicsIn = record(root.basics);
  const warnings: string[] = [];

  const result: ImportedProfileDto = {
    basics: {
      display_name: text(basicsIn.display_name, 200),
      headline: text(basicsIn.headline, 120),
      bio: text(basicsIn.bio, 2000),
      country: text(basicsIn.country, 100),
      city: text(basicsIn.city, 100),
    },
    skills: [],
    languages: [],
    experiences: [],
    educations: [],
    certifications: [],
    links: [],
    warnings,
  };

  for (const entry of array(root.skills, CAPS.skills)) {
    const item = record(entry);
    const name = text(item.name, 120);
    if (!name) continue;
    const level = item.proficiency_level;
    result.skills!.push({
      name,
      proficiency_level: PROFICIENCY_LEVELS.includes(level as never)
        ? (level as (typeof PROFICIENCY_LEVELS)[number])
        : undefined,
    });
  }

  for (const entry of array(root.languages, CAPS.languages)) {
    const item = record(entry);
    const name = text(item.name, 80);
    if (!name) continue;
    const level = item.fluency_level;
    result.languages!.push({
      name,
      fluency_level: FLUENCY_LEVELS.includes(level as never)
        ? (level as (typeof FLUENCY_LEVELS)[number])
        : undefined,
    });
  }

  let droppedRoles = 0;
  for (const entry of array(root.experiences, CAPS.experiences)) {
    const item = record(entry);
    const company = text(item.company, 200);
    const title = text(item.title, 200);
    const start = isoDate(item.start_date);
    // start_date is DATE NOT NULL; a role without one cannot be stored, and
    // inventing a date would be worse than dropping it with a warning.
    if (!company || !title || !start) {
      if (company || title) droppedRoles += 1;
      continue;
    }
    result.experiences!.push({
      company,
      title,
      location: text(item.location, 200),
      description: text(item.description, 5000),
      start_date: start,
      end_date: isoDate(item.end_date),
      is_current: item.is_current === true,
    });
  }
  if (droppedRoles > 0) {
    warnings.push(
      `${droppedRoles} role${droppedRoles === 1 ? '' : 's'} had no readable dates and ${droppedRoles === 1 ? 'was' : 'were'} left out. Add ${droppedRoles === 1 ? 'it' : 'them'} below if you need ${droppedRoles === 1 ? 'it' : 'them'}.`,
    );
  }

  for (const entry of array(root.educations, CAPS.educations)) {
    const item = record(entry);
    const institution = text(item.institution, 200);
    if (!institution) continue;
    result.educations!.push({
      institution,
      degree: text(item.degree, 200),
      field_of_study: text(item.field_of_study, 200),
      start_year: year(item.start_year),
      end_year: year(item.end_year),
    });
  }

  for (const entry of array(root.certifications, CAPS.certifications)) {
    const item = record(entry);
    const name = text(item.name, 300);
    if (!name) continue;
    result.certifications!.push({
      name,
      issuer: text(item.issuer, 200),
    });
  }

  for (const entry of array(root.links, CAPS.links)) {
    const url = text(entry, 500);
    if (!url) continue;
    // Only absolute http(s) survives — @IsUrl() rejects bare domains, and a
    // javascript: or data: URL has no business reaching a profile page.
    if (!/^https?:\/\/[^\s]+$/i.test(url)) continue;
    result.links!.push(url);
  }

  return result;
}

import type { PdfLine } from './pdf-layout';
import type { PdfDocumentText } from '../services/pdf-text-extractor.service';
import type { ImportedProfileDto } from '../dto/imported-profile.dto';

/**
 * The deterministic LinkedIn "Save to PDF" parser.
 *
 * Pure functions over already-extracted lines, so the whole grammar is testable
 * from a JSON fixture rather than a real person's CV.
 *
 * The structure is carried entirely by FONT SIZE, verified against a real
 * export:
 *
 *   26     the name
 *   15.75  section heading (Summary / Experience / Education)
 *   12     headline, location, company, institution, summary body
 *   11.5   role title
 *   10.5   date ranges, group durations, role locations, descriptions
 *
 * Anything that needs to distinguish two things at the SAME size falls back to
 * line leading, never to text heuristics.
 */

const SECTION_HEADINGS = new Set([
  'summary',
  'experience',
  'education',
  'licenses & certifications',
  'volunteering',
  'projects',
  'courses',
  'honors-awards',
  'publications',
]);

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const DATE_RANGE =
  /^([A-Za-z]+)?\s*(\d{4})\s*-\s*(?:(Present)|([A-Za-z]+)?\s*(\d{4}))/;
const DURATION_ONLY = /^\d+\s+(?:year|month)s?(?:\s+\d+\s+months?)?$/i;

export interface ParsedDate {
  iso: string | null;
  precision: 'month' | 'year' | 'unknown';
}

/**
 * LinkedIn emits "August 2025", never a day. `user_experiences.start_date` is
 * DATE NOT NULL with nowhere to record that the day is unknown, so day 01 is
 * synthesized and the precision is reported alongside for the UI to flag.
 */
export function parseMonthYear(
  month: string | undefined,
  year: string,
): ParsedDate {
  const y = Number.parseInt(year, 10);
  if (!Number.isFinite(y)) return { iso: null, precision: 'unknown' };
  const m = month ? MONTHS[month.trim().toLowerCase()] : undefined;
  if (!m) return { iso: `${y}-01-01`, precision: 'year' };
  return { iso: `${y}-${String(m).padStart(2, '0')}-01`, precision: 'month' };
}

/** Last day of the month, so "May 2025 - October 2025 (6 months)" reads as 6. */
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map((n) => Number.parseInt(n, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export interface LinkedInDetection {
  isLinkedIn: boolean;
  score: number;
  reasons: string[];
}

/**
 * Metadata is the strongest signal by a wide margin — LinkedIn stamps
 * `/Author (LinkedIn)` on every export — but the geometric signals alone also
 * clear the bar, so the detector survives a metadata change.
 */
export function detectLinkedIn(doc: PdfDocumentText): LinkedInDetection {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if ((doc.info.author ?? '').trim().toLowerCase() === 'linkedin') {
    add(70, 'metadata author is LinkedIn');
  }
  if (/^Apache FOP/i.test(doc.info.producer ?? '')) {
    add(15, 'produced by Apache FOP');
  }
  if (/generated from profile/i.test(doc.info.subject ?? '')) {
    add(15, 'subject mentions profile export');
  }
  if (doc.twoColumn) add(40, 'two-column layout');
  if (doc.sidebar.some((l) => l.text === 'Contact')) {
    add(20, 'sidebar has a Contact block');
  }
  if (
    doc.sidebar.some((l) =>
      /^(Top Skills|Certifications|Languages|Honors-Awards|Publications)$/.test(
        l.text,
      ),
    )
  ) {
    add(20, 'sidebar has a known LinkedIn section');
  }

  return { isLinkedIn: score >= 60, score, reasons };
}

function isSectionHeading(line: PdfLine): boolean {
  return (
    line.size > 13.5 &&
    line.size < 20 &&
    SECTION_HEADINGS.has(line.text.toLowerCase())
  );
}

/** Splits the sidebar into its headed blocks. */
function sidebarSections(lines: PdfLine[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  const headingSize = Math.max(...lines.map((l) => l.size), 0);

  for (const line of lines) {
    // Sidebar headings render a step larger than their body text.
    const looksLikeHeading =
      line.size >= headingSize - 0.6 &&
      /^[A-Z][A-Za-z\s-]{2,30}$/.test(line.text);
    if (looksLikeHeading && line.text.split(' ').length <= 3) {
      current = line.text.toLowerCase();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(line.text);
  }
  return sections;
}

function normalizeUrl(raw: string): string | null {
  const cleaned = raw
    .replace(
      /\s*\((?:LinkedIn|Blog|Company|Personal|Portfolio|Github|Twitter|Other)\)\s*$/i,
      '',
    )
    .trim();
  if (!cleaned) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  // Bare domains are the norm in the Contact block, and @IsUrl() rejects them.
  if (
    /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(cleaned) ||
    /^www\./i.test(cleaned)
  ) {
    return `https://${cleaned}`;
  }
  return null;
}

export function parseLinkedIn(doc: PdfDocumentText): ImportedProfileDto {
  const warnings: string[] = [];
  const result: ImportedProfileDto = {
    source: 'linkedin_pdf',
    basics: {},
    skills: [],
    languages: [],
    experiences: [],
    educations: [],
    certifications: [],
    links: [],
    warnings,
  };

  // ---------------------------------------------------------------- sidebar
  const sections = sidebarSections(doc.sidebar);

  for (const value of sections.get('contact') ?? []) {
    const url = normalizeUrl(value);
    if (url) result.links!.push(url);
  }

  for (const skill of sections.get('top skills') ?? []) {
    // "Top Skills" on LinkedIn are the endorsed ones.
    result.skills!.push({ name: skill, proficiency_level: 'advanced' });
  }

  for (const cert of sections.get('certifications') ?? []) {
    // No issuer: LinkedIn simply does not emit one in this block. The column
    // is nullable as of 20260820100000 precisely so this does not 500.
    result.certifications!.push({ name: cert });
  }

  for (const raw of sections.get('languages') ?? []) {
    const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const name = (match ? match[1] : raw).trim();
    const qualifier = (match ? match[2] : '').toLowerCase();
    const fluency = /native|bilingual/.test(qualifier)
      ? 'native'
      : /full professional|professional working/.test(qualifier)
        ? 'fluent'
        : /limited working/.test(qualifier)
          ? 'conversational'
          : /elementary/.test(qualifier)
            ? 'basic'
            : undefined;
    if (name) result.languages!.push({ name, fluency_level: fluency });
  }

  // ------------------------------------------------------------------- main
  const main = doc.main;
  const firstSection = main.findIndex(isSectionHeading);
  const header = firstSection === -1 ? main : main.slice(0, firstSection);

  const nameLine = header.find((l) => l.size > 20);
  if (nameLine) result.basics!.display_name = nameLine.text;

  const headerBody = header.filter((l) => l !== nameLine && l.size > 10.8);
  if (headerBody.length) {
    const last = headerBody[headerBody.length - 1];
    const looksLikeLocation =
      last.text.length <= 60 &&
      (last.text.match(/,/g)?.length ?? 0) <= 3 &&
      !/[|@\d]/.test(last.text);

    const headlineLines = looksLikeLocation
      ? headerBody.slice(0, -1)
      : headerBody;
    const headline = headlineLines
      .map((l) => l.text)
      .join(' ')
      .trim();
    if (headline) result.basics!.headline = headline.slice(0, 120);

    if (looksLikeLocation) {
      const parts = last.text
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      result.basics!.city = parts[0];
      result.basics!.country = parts[parts.length - 1];
    }
  }

  // Walk the remaining sections.
  let index = firstSection === -1 ? main.length : firstSection;
  while (index < main.length) {
    const heading = main[index].text.toLowerCase();
    index += 1;
    const body: PdfLine[] = [];
    while (index < main.length && !isSectionHeading(main[index])) {
      body.push(main[index]);
      index += 1;
    }

    if (heading === 'summary') {
      const bio = body
        .map((l) => l.text)
        .join(' ')
        .trim();
      if (bio) result.basics!.bio = bio.slice(0, 2000);
    } else if (heading === 'experience') {
      result.experiences!.push(...parseExperience(body, warnings));
    } else if (heading === 'education') {
      result.educations!.push(...parseEducation(body));
    } else {
      warnings.push(
        `The "${main[index - 1]?.text ?? heading}" section was skipped.`,
      );
    }
  }

  if (!result.basics!.headline) {
    warnings.push('No headline was found — it is required before going live.');
  }

  return result;
}

interface RoleAccumulator {
  company: string;
  title: string | null;
  start?: ParsedDate;
  end?: ParsedDate;
  isCurrent: boolean;
  location?: string;
  description: string[];
  awaitingLocation: boolean;
}

function parseExperience(
  body: PdfLine[],
  warnings: string[],
): NonNullable<ImportedProfileDto['experiences']> {
  const out: NonNullable<ImportedProfileDto['experiences']> = [];
  let company: string | null = null;
  let role: RoleAccumulator | null = null;

  const flush = () => {
    if (!role || !role.title || !role.start?.iso) {
      if (role && role.title) {
        warnings.push(`Skipped "${role.title}" — no dates were found for it.`);
      }
      role = null;
      return;
    }
    out.push({
      company: role.company,
      title: role.title,
      location: role.location,
      description: role.description.join('\n').trim() || undefined,
      start_date: role.start.iso,
      end_date: role.end?.iso ? endOfMonth(role.end.iso) : undefined,
      is_current: role.isCurrent,
    });
    role = null;
  };

  for (const line of body) {
    // 12pt = a company. Opens a group; grouped roles nest beneath it.
    if (line.size >= 11.8) {
      flush();
      company = line.text;
      continue;
    }
    // 11.5pt = a role title.
    if (line.size >= 11.2) {
      flush();
      role = {
        company: company ?? 'Unknown',
        title: line.text,
        isCurrent: false,
        description: [],
        awaitingLocation: false,
      };
      continue;
    }

    // 10.5pt: dates, the group total-duration line, location, or description.
    const dateMatch = line.text.match(DATE_RANGE);
    if (dateMatch && role) {
      role.start = parseMonthYear(dateMatch[1], dateMatch[2]);
      if (dateMatch[3]) {
        role.isCurrent = true;
      } else if (dateMatch[5]) {
        role.end = parseMonthYear(dateMatch[4], dateMatch[5]);
      }
      role.awaitingLocation = true;
      continue;
    }
    // A bare duration with no open role is the header of a grouped company.
    if (DURATION_ONLY.test(line.text) && !role) continue;

    if (role?.awaitingLocation) {
      role.awaitingLocation = false;
      // A location is short and comma-shaped; a description is a sentence.
      const isLocation =
        line.text.length <= 60 &&
        !/[.!?]$/.test(line.text) &&
        (line.text.match(/,/g)?.length ?? 0) <= 3;
      if (isLocation) {
        role.location = line.text;
        continue;
      }
    }
    if (role) role.description.push(line.text);
  }
  flush();
  return out;
}

function parseEducation(
  body: PdfLine[],
): NonNullable<ImportedProfileDto['educations']> {
  const out: NonNullable<ImportedProfileDto['educations']> = [];
  let institution: string | null = null;

  for (const line of body) {
    if (line.size >= 11.8) {
      institution = line.text;
      continue;
    }
    if (!institution) continue;

    let text = line.text;
    let startYear: number | undefined;
    let endYear: number | undefined;

    const years = text.match(/\s*·?\s*\((\d{4})\s*-\s*(\d{4}|Present)\)\s*$/i);
    if (years) {
      text = text.slice(0, years.index).trim();
      startYear = Number.parseInt(years[1], 10);
      if (!/present/i.test(years[2])) endYear = Number.parseInt(years[2], 10);
    }

    // "Bachelor of Science - BS, Computer Engineering"
    const split = text.match(/^(.*?)\s*-\s*[A-Za-z.]{2,6},\s*(.+)$/);
    out.push({
      institution,
      degree: (split ? split[1] : text) || undefined,
      field_of_study: split ? split[2] : undefined,
      start_year: startYear,
      end_year: endYear,
    });
    institution = null;
  }
  return out;
}

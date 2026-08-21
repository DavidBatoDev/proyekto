import * as fs from 'fs';
import * as path from 'path';
import {
  detectLinkedIn,
  endOfMonth,
  parseLinkedIn,
  parseMonthYear,
} from './lib/linkedin-parser';
import {
  groupIntoLines,
  mergeWrappedLines,
  type PdfTextItem,
} from './lib/pdf-layout';
import { findColumnBoundary } from './lib/column-boundary';
import { sanitizeImportedProfile } from './lib/sanitize-imported-profile';
import { PdfjsLoaderService } from './services/pdfjs-loader.service';
import { PdfTextExtractorService } from './services/pdf-text-extractor.service';

const item = (
  x: number,
  y: number,
  text: string,
  size = 10.5,
  page = 1,
  w = 100,
): PdfTextItem => ({ x, y, w, size, text, page });

describe('pdf-layout', () => {
  describe('mergeWrappedLines', () => {
    /**
     * The measurements below are taken verbatim from a real LinkedIn export.
     * Apache FOP lays a wrapped continuation at 1.2x the font size (12.60 at
     * 10.5pt) and separates list items by that plus a 5pt space-before (17.60).
     * This is the single most load-bearing rule in the parser.
     */
    it('rejoins wrapped certifications and keeps separate ones apart', () => {
      const lines = groupIntoLines([
        item(21.6, 522.21, 'Software Engineering Principles in'),
        item(21.6, 509.61, 'Python'),
        item(21.6, 492.01, 'Full Stack Web Development'),
        item(21.6, 474.41, 'Claude Certified Architect -'),
        item(21.6, 461.81, 'Professional'),
        item(21.6, 444.21, 'AWS Cloud Practitioner Essentials'),
        item(21.6, 426.61, 'Introduction to Cybersecurity'),
        item(21.6, 414.01, 'Essentials'),
      ]);

      expect(mergeWrappedLines(lines).map((l) => l.text)).toEqual([
        'Software Engineering Principles in Python',
        'Full Stack Web Development',
        'Claude Certified Architect - Professional',
        'AWS Cloud Practitioner Essentials',
        'Introduction to Cybersecurity Essentials',
      ]);
    });

    it('leaves uniformly spaced items alone', () => {
      // Top Skills are all 17.60 apart: three items, not one wrapped blob.
      const lines = groupIntoLines([
        item(21.6, 600, 'Enterprise Architecture'),
        item(21.6, 582.4, 'Evaluation & Optimization'),
        item(21.6, 564.8, 'Integration Architecture'),
      ]);
      expect(mergeWrappedLines(lines)).toHaveLength(3);
    });

    it('never merges across a page break', () => {
      const lines = groupIntoLines([
        item(21.6, 60, 'Trailing line', 10.5, 1),
        item(21.6, 56, 'First line of next page', 10.5, 2),
      ]);
      expect(mergeWrappedLines(lines)).toHaveLength(2);
    });
  });

  describe('groupIntoLines', () => {
    it('keeps same-height lines on different pages apart', () => {
      // Every page starts its body at the same offset, so bucketing on y alone
      // silently fuses page 1 and page 2 into one line.
      const lines = groupIntoLines([
        item(224, 700, 'Page one text', 12, 1),
        item(224, 700, 'Page two text', 12, 2),
      ]);
      expect(lines.map((l) => l.text)).toEqual([
        'Page one text',
        'Page two text',
      ]);
    });

    it('joins runs with no gap and spaces the rest', () => {
      const lines = groupIntoLines([
        item(224, 500, 'August 2025 - Present ', 10.5, 1, 96),
        item(320, 500, '(1 year 1 month)', 10.5, 1, 70),
      ]);
      expect(lines[0].text).toBe('August 2025 - Present (1 year 1 month)');
    });
  });

  describe('findColumnBoundary', () => {
    it('detects the sidebar/main split and ignores stray runs', () => {
      const items = [
        ...Array.from({ length: 18 }, (_, i) =>
          item(21.6, 700 - i * 12, 'side', 10.5, 1, 160),
        ),
        ...Array.from({ length: 35 }, (_, i) =>
          item(223.6, 700 - i * 12, 'main', 12, 1, 340),
        ),
        // Mid-line continuation runs: these broke an earlier clustering approach.
        item(105, 690, '(LinkedIn)', 11, 1, 50),
        item(152, 640, 'fragment', 10.5, 1, 40),
      ];
      const boundary = findColumnBoundary(items);
      expect(boundary).not.toBeNull();
      expect(boundary!).toBeGreaterThan(160);
      expect(boundary!).toBeLessThan(223.6);
    });

    it('returns null for a single-column document', () => {
      const items = Array.from({ length: 40 }, (_, i) =>
        item(72, 700 - i * 14, 'body text', 11, 1, 400),
      );
      expect(findColumnBoundary(items)).toBeNull();
    });
  });
});

describe('linkedin dates', () => {
  it('synthesizes day 01 and reports month precision', () => {
    expect(parseMonthYear('August', '2025')).toEqual({
      iso: '2025-08-01',
      precision: 'month',
    });
  });

  it('falls back to year precision when the month is unreadable', () => {
    expect(parseMonthYear('aoUt', '2025')).toEqual({
      iso: '2025-01-01',
      precision: 'year',
    });
  });

  it('ends a range on the last day so durations read correctly', () => {
    // "May 2025 - October 2025 (6 months)" must span 6 months, not 5.
    expect(endOfMonth('2025-10-01')).toBe('2025-10-31');
    expect(endOfMonth('2024-02-01')).toBe('2024-02-29');
  });
});

describe('sanitizeImportedProfile', () => {
  it('returns an empty draft for junk', () => {
    const clean = sanitizeImportedProfile(null);
    expect(clean.basics).toEqual({
      display_name: undefined,
      headline: undefined,
      bio: undefined,
      country: undefined,
      city: undefined,
    });
    expect(clean.experiences).toEqual([]);
  });

  it('caps runaway arrays', () => {
    const clean = sanitizeImportedProfile({
      skills: Array.from({ length: 500 }, (_, i) => ({ name: `skill ${i}` })),
    });
    expect(clean.skills).toHaveLength(30);
  });

  it('drops roles with no usable start date and says so', () => {
    const clean = sanitizeImportedProfile({
      experiences: [
        { company: 'Acme', title: 'Engineer', start_date: 'sometime in 2020' },
        { company: 'Beta', title: 'Lead', start_date: '2021-03-01' },
      ],
    });
    expect(clean.experiences).toHaveLength(1);
    expect(clean.warnings?.join(' ')).toMatch(/no readable dates/i);
  });

  it('rejects non-http links', () => {
    const clean = sanitizeImportedProfile({
      links: ['javascript:alert(1)', 'https://example.com/x', 'example.com'],
    });
    expect(clean.links).toEqual(['https://example.com/x']);
  });
});

/**
 * These need `NODE_OPTIONS=--experimental-vm-modules` (see `npm run test:import`).
 * Jest runs modules inside a VM context, and a dynamic ESM import from there is
 * refused without that flag -- pdfjs-dist v5 is ESM-only, so the loader trips it.
 * This is a Jest limitation only: the same code compiled by `nest build` and run
 * on plain Node works, which is what production does.
 *
 * The real export is gitignored on purpose -- it is a named person's email and
 * employment history. These run only on a machine that has one.
 */
const SAMPLE = path.resolve(__dirname, '../../../../../Profile.pdf');

/**
 * Gated on the flag as well as the file, so a plain `npm test` stays green
 * instead of failing on an environment limitation that says nothing about the
 * code. `npm run test:import` supplies the flag and runs the full set.
 */
const vmModulesEnabled =
  process.execArgv.some((a) => a.includes('experimental-vm-modules')) ||
  (process.env.NODE_OPTIONS ?? '').includes('experimental-vm-modules');

const withSample =
  fs.existsSync(SAMPLE) && vmModulesEnabled ? describe : describe.skip;

withSample('end to end against a real LinkedIn export', () => {
  jest.setTimeout(30_000);
  let profile: ReturnType<typeof parseLinkedIn>;

  beforeAll(async () => {
    const service = new PdfTextExtractorService(new PdfjsLoaderService());
    const doc = await service.extract(fs.readFileSync(SAMPLE));
    expect(detectLinkedIn(doc).isLinkedIn).toBe(true);
    expect(doc.twoColumn).toBe(true);
    profile = parseLinkedIn(doc);
  });

  it('reads the header', () => {
    expect(profile.basics?.display_name).toBeTruthy();
    expect(profile.basics?.headline).toBeTruthy();
    expect(profile.basics?.country).toBeTruthy();
  });

  it('reads the summary as one clean paragraph', () => {
    expect((profile.basics?.bio ?? '').length).toBeGreaterThan(500);
    // Sidebar bleed was the original failure mode here.
    expect(profile.basics?.bio).not.toMatch(/Top Skills|Certifications/);
  });

  it('reassembles wrapped certifications', () => {
    expect(profile.certifications?.length).toBeGreaterThanOrEqual(5);
    expect(profile.certifications?.map((c) => c.name)).toContain(
      'Software Engineering Principles in Python',
    );
  });

  it('splits grouped companies into their individual roles', () => {
    const byCompany = new Map<string, number>();
    for (const role of profile.experiences ?? []) {
      byCompany.set(role.company, (byCompany.get(role.company) ?? 0) + 1);
    }
    expect([...byCompany.values()].some((n) => n > 1)).toBe(true);
    expect(profile.experiences!.length).toBeGreaterThanOrEqual(8);
  });

  it('never leaks a page footer into a field', () => {
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toMatch(/Page \d+ of \d+/);
  });

  it('gives every role a usable start date', () => {
    for (const role of profile.experiences ?? []) {
      expect(role.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

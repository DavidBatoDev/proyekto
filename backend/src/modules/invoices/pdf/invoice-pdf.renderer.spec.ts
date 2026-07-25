import zlib from 'node:zlib';
import { renderInvoicePdf } from './invoice-pdf.renderer';

/**
 * Extracts the visible text runs from a pdfkit-generated PDF, each paired with
 * its baseline x/y from the preceding `Tm` operator. pdfkit writes strings as
 * hex arrays inside `[ ... ] TJ`, so we decode the hex and drop kerning numbers.
 */
function extractRuns(
  pdf: Buffer,
): Array<{ x: number; y: number; text: string }> {
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf.toString('latin1'))) !== null) {
    try {
      streams.push(
        zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'),
      );
    } catch {
      // uncompressed or non-text stream — skip
    }
  }
  const blob = streams.join('\n');
  const runs: Array<{ x: number; y: number; text: string }> = [];
  const tm = /1 0 0 1 ([\d.]+) ([\d.]+) Tm[\s\S]*?\[([\s\S]*?)\]\s*TJ/g;
  while ((m = tm.exec(blob)) !== null) {
    const hex = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((h) =>
      Buffer.from(h[1], 'hex').toString('latin1'),
    );
    const text = hex.join('');
    if (text.trim()) {
      runs.push({ x: Number(m[1]), y: Number(m[2]), text });
    }
  }
  return runs;
}

describe('renderInvoicePdf', () => {
  const input = {
    number: 'BS2026-001',
    currency: 'USD',
    issueDate: '2026-08-31',
    dueDate: '2026-09-15',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    issuedBy: {
      name: 'Prodigitality Services Inc.',
      address: 'Unit 26, 4th Floor The Site Plaza, Marikina City',
      tin: '617-100-003-00000',
      email: 'billing@prodigitality.net',
    },
    billTo: { name: 'Filro Caregivers' },
    paymentMethod: 'Online payment',
    total: 386.25,
    lines: [
      {
        description: 'Digital marketing services (2026-08-01 to 2026-08-31)',
        quantity: 25.75,
        unit_rate: 15,
        amount: 386.25,
        isHours: true,
      },
    ],
  };

  it('produces a valid PDF document', async () => {
    const pdf = await renderInvoicePdf(input);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders every field from the Canva layout', async () => {
    const pdf = await renderInvoicePdf(input);
    const text = extractRuns(pdf)
      .map((r) => r.text)
      .join('\n');

    expect(text).toContain('PRODIGITALITY SERVICES INC.');
    expect(text).toContain('TIN: 617-100-003-00000');
    expect(text).toContain('FILRO CAREGIVERS');
    expect(text).toContain('#BS2026-001');
    expect(text).toContain('DIGITAL MARKETING SERVICES');
    expect(text).toContain('25.75 HOURS');
    expect(text).toContain('ONLINE PAYMENT');
  });

  // Regression: an earlier 12%-wide rate column wrapped "USD 15.00" onto a
  // second line, so the invoice showed a bare "USD" beside the amount. The
  // money value must render as ONE run, not split across two.
  it('keeps the rate and total on a single line each', async () => {
    const pdf = await renderInvoicePdf(input);
    const runs = extractRuns(pdf);

    // The rate cell holds the full "USD 15.00", not a lone "USD".
    const bareCurrency = runs.filter((r) => r.text.trim() === 'USD');
    expect(bareCurrency).toHaveLength(0);

    const rateRun = runs.find((r) => r.text.includes('15.00'));
    expect(rateRun?.text).toBe('USD 15.00');
    const totalRun = runs.find((r) => r.text.includes('386.25'));
    expect(totalRun?.text).toBe('USD 386.25');
  });

  it('renders a retainer quantity as a bare count, not hours', async () => {
    const pdf = await renderInvoicePdf({
      ...input,
      lines: [
        {
          description: 'Professional services (2026-08-01 to 2026-08-31)',
          quantity: 1,
          unit_rate: 15000,
          amount: 15000,
          isHours: false,
        },
      ],
      total: 15000,
    });
    const runs = extractRuns(pdf);
    // The qty column shows "1", never "1 HOURS".
    expect(runs.some((r) => r.text.trim() === '1')).toBe(true);
    expect(runs.some((r) => r.text.includes('1 HOURS'))).toBe(false);
  });
});

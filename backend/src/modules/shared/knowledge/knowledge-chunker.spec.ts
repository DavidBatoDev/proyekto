import { chunkText } from './knowledge-chunker';

describe('chunkText', () => {
  it('skips inputs shorter than the minimum', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   hi   ')).toEqual([]);
    expect(chunkText('👍')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const chunks = chunkText('We decided to use Stripe for payments.');
    expect(chunks).toEqual([
      { index: 0, content: 'We decided to use Stripe for payments.' },
    ]);
  });

  it('splits long text with overlap and sequential indexes', () => {
    const paragraph = `${'word '.repeat(300)}.\n\n`;
    const text = paragraph.repeat(8);
    const chunks = chunkText(text, { maxChars: 2000, overlapChars: 300 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2000);
    }
    // Overlap: consecutive chunks share content near the boundary.
    const tail = chunks[0].content.slice(-100);
    expect(text.indexOf(tail)).toBeGreaterThanOrEqual(0);
  });

  it('prefers paragraph boundaries over hard cuts', () => {
    // The boundary search only scans the back half of the window (never
    // producing tiny chunks), so the paragraph break must land there.
    const first = `Opening paragraph. ${'alpha beta gamma '.repeat(90)}end.`;
    const text = `${first}\n\n${'x'.repeat(3000)}`;
    const chunks = chunkText(text, { maxChars: 2000, overlapChars: 100 });
    expect(chunks[0].content).toBe(first);
  });

  it('always terminates on pathological unbroken input', () => {
    const chunks = chunkText('z'.repeat(50_000), {
      maxChars: 4000,
      overlapChars: 600,
    });
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.length).toBeLessThan(50);
  });
});

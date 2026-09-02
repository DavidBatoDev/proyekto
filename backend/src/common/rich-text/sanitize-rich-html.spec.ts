import {
  sanitizeOptionalRichHtml,
  sanitizeRichHtml,
} from './sanitize-rich-html';

/**
 * These tests are the argument for the function existing. The web sanitizes at
 * render, so a browser-authored description was never the threat; the threat is
 * a direct `PATCH /api/teams/:id`, which reaches the column without passing a
 * browser at all. Each case below is something an owner or admin could curl
 * today.
 */
describe('sanitizeRichHtml', () => {
  it('drops a script tag and its contents, not just the tag', () => {
    const out = sanitizeRichHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('alert');
  });

  it('strips inline event handlers while keeping the element', () => {
    const out = sanitizeRichHtml('<p onclick="steal()">text</p>');
    expect(out).toBe('<p>text</p>');
  });

  it('drops a javascript: href but keeps the link text', () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('drops a data: href, which is the usual way past a naive scheme check', () => {
    const out = sanitizeRichHtml(
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    );
    expect(out).not.toContain('data:');
  });

  it('keeps http, https and mailto links with their attributes', () => {
    const out = sanitizeRichHtml(
      '<a href="https://example.com" target="_blank" rel="noopener">e</a>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener"');
    expect(sanitizeRichHtml('<a href="mailto:a@b.c">m</a>')).toContain(
      'mailto:a@b.c',
    );
  });

  it('keeps the formatting the editor actually produces', () => {
    const rich =
      '<p><strong>Design</strong> team</p><ul><li>Mondays</li></ul><h3>Links</h3><blockquote>q</blockquote>';
    expect(sanitizeRichHtml(rich)).toBe(rich);
  });

  it('strips style and class, which would let a description restyle the page', () => {
    const out = sanitizeRichHtml(
      '<p style="position:fixed;inset:0" class="app-shell">x</p>',
    );
    expect(out).toBe('<p>x</p>');
  });

  it('drops img, since nothing uploads through this path', () => {
    expect(sanitizeRichHtml('<img src="https://e.com/x.png">')).toBe('');
  });

  it('drops iframe and object embeds', () => {
    expect(
      sanitizeRichHtml('<iframe src="https://evil.example"></iframe>'),
    ).toBe('');
    expect(sanitizeRichHtml('<object data="x"></object>')).toBe('');
  });

  it('leaves plain text alone, so legacy descriptions round-trip unchanged', () => {
    expect(sanitizeRichHtml('Our design team. Weekly sync Mondays.')).toBe(
      'Our design team. Weekly sync Mondays.',
    );
  });
});

describe('sanitizeOptionalRichHtml', () => {
  it('passes undefined and null through, so an absent DTO field stays absent', () => {
    expect(sanitizeOptionalRichHtml(undefined)).toBeUndefined();
    expect(sanitizeOptionalRichHtml(null)).toBeNull();
  });

  it('passes the empty string through, which is how a description is cleared', () => {
    expect(sanitizeOptionalRichHtml('')).toBe('');
  });

  it('sanitizes a present value', () => {
    expect(sanitizeOptionalRichHtml('<p onclick="x()">hi</p>')).toBe(
      '<p>hi</p>',
    );
  });
});

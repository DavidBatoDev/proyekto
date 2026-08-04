import { escapeHtml, safeHttpUrl } from './escape';
import {
  renderCodeBlock,
  renderDetailRows,
  renderEmailLayout,
  renderParagraph,
  renderQuoteBlock,
} from './layout';
import { renderTextEmail } from './text';

describe('escapeHtml', () => {
  it('neutralises the five characters that make markup', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('escapes ampersands first so entities are not double-broken', () => {
    // Naive ordering yields `&amp;lt;` here.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('safeHttpUrl', () => {
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['ftp://example.test/x'],
    [''],
    [null],
  ])('rejects %s', (value) => {
    expect(safeHttpUrl(value)).toBeNull();
  });

  it('accepts and escapes http(s)', () => {
    expect(safeHttpUrl('https://cdn.example.test/a.png?x=1&y=2')).toBe(
      'https://cdn.example.test/a.png?x=1&amp;y=2',
    );
  });
});

describe('renderEmailLayout', () => {
  const base = {
    preheader: 'Ada mentioned you',
    title: 'You were mentioned',
    bodyHtml: renderParagraph('Body copy'),
    footerNote: 'You received this because you were mentioned on Proyekto.',
  };

  it('renders the brand chrome', () => {
    const html = renderEmailLayout(base);

    expect(html).toMatchSnapshot();
  });

  it('renders the CTA as one button and nothing else', () => {
    const html = renderEmailLayout({
      ...base,
      cta: { label: 'View comment', href: 'https://app.proyekto.test/c/1' },
    });

    expect(html).toContain('View comment');
    // Exactly once: the button. The old layout also printed the raw URL under
    // it behind "Button not working?", which was the bulk of the visual noise.
    expect(html.match(/https:\/\/app\.proyekto\.test\/c\/1/g)).toHaveLength(1);
    expect(html).not.toContain('Button not working?');
  });

  it('omits the CTA block entirely when there is no CTA', () => {
    const html = renderEmailLayout(base);

    expect(html).not.toContain('<a href=');
  });

  it('renders a greeting only when given one', () => {
    expect(renderEmailLayout(base)).not.toContain('Hi ');
    expect(renderEmailLayout({ ...base, greeting: 'Hi David,' })).toContain(
      'Hi David,',
    );
  });

  it('escapes the greeting', () => {
    const html = renderEmailLayout({
      ...base,
      greeting: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders an unsubscribe link only when given one', () => {
    expect(renderEmailLayout(base)).not.toContain('Unsubscribe');
    expect(
      renderEmailLayout({
        ...base,
        unsubscribeHref:
          'https://api.proyekto.test/api/notifications/unsubscribe?token=t',
      }),
    ).toContain('Unsubscribe from these emails');
  });

  it('escapes every layout-owned field', () => {
    const html = renderEmailLayout({
      ...base,
      preheader: '<script>alert(1)</script>',
      title: '<img src=x onerror=alert(2)>',
      footerNote: '</td></table><b>escape me</b>',
      cta: { label: '<b>Click</b>', href: 'https://x.test/"><script>' },
    });

    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>escape me</b>');
    expect(html).not.toContain('<b>Click</b>');
  });
});

describe('renderQuoteBlock', () => {
  it('escapes the quoted text', () => {
    // The excerpt originates from a comment body. `sanitizeCommentHtml` is a
    // regex strip rather than a whitelist, so nothing upstream can be trusted
    // to have removed markup — this is the last line of defence.
    const html = renderQuoteBlock('<img src=x onerror=alert(1)> hello');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('hello');
  });

  it('preserves line breaks visually rather than as markup', () => {
    const html = renderQuoteBlock('line one\nline two');

    expect(html).toContain('white-space:pre-wrap');
    expect(html).not.toContain('<br');
  });
});

describe('renderDetailRows', () => {
  it('renders one row per entry, borderless', () => {
    const html = renderDetailRows([
      { label: 'Amount due', value: 'USD 10.00' },
      { label: 'Due date', value: '1 September 2026' },
    ]);

    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html).toContain('Amount due');
    expect(html).toContain('1 September 2026');
    // The panel around the figures is gone — no border, no fill.
    expect(html).not.toContain('border:');
    expect(html).not.toContain('background-color');
  });

  // These helpers take pre-escaped values so callers can pass markup like
  // <strong>. That contract is the reason escaping lives at the call site.
  it('does not double-escape values the caller already escaped', () => {
    const html = renderDetailRows([
      { label: 'Project', value: '&lt;script&gt;' },
    ]);

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('&amp;lt;');
  });
});

describe('renderCodeBlock', () => {
  it('shows the code without making it a link', () => {
    const html = renderCodeBlock('123456');

    expect(html).toContain('123456');
    // A one-time code styled as a button teaches people to click buttons in
    // emails that ask for credentials.
    expect(html).not.toContain('<a ');
    expect(html).toContain('letter-spacing');
  });

  it('escapes the code', () => {
    expect(renderCodeBlock('<b>1</b>')).not.toContain('<b>');
  });
});

describe('renderTextEmail', () => {
  it('drops nullish lines and collapses blank runs', () => {
    expect(
      renderTextEmail(['Title', '', null, '', undefined, 'Body', '']),
    ).toBe('Title\n\nBody');
  });
});

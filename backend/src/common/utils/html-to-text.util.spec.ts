import { htmlToText, truncatePromptText } from './html-to-text.util';

describe('htmlToText', () => {
  it('preserves useful structure, decodes entities, and removes unsafe blocks', () => {
    const html = [
      '<h2>Scope &amp; goals</h2>',
      '<p>Build&nbsp;the thing<br>Safely</p>',
      '<ul><li>First</li><li>Second &#x2713;</li></ul>',
      '<script>alert("ignore me")</script>',
      '<style>.ignore { display: none }</style>',
    ].join('');

    expect(htmlToText(html)).toBe(
      'Scope & goals\nBuild the thing\nSafely\n- First\n- Second \u2713',
    );
  });

  it('applies an exact hard cap including the ellipsis', () => {
    const result = htmlToText(`<p>${'x'.repeat(100)}</p>`, 20);

    expect(result).toHaveLength(20);
    expect(result).toBe(`${'x'.repeat(19)}\u2026`);
    expect(truncatePromptText('abcdef', 1)).toBe('\u2026');
  });

  it('returns empty text for empty input or a non-positive cap', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('<p>content</p>', 0)).toBe('');
  });
});

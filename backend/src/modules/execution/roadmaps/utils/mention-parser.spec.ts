import {
  MAX_EMAIL_MENTIONS_PER_COMMENT,
  extractMentionedEmails,
  extractMentionedUserIds,
} from './mention-parser';

const span = (attr: string, value: string) =>
  `<span class="mention" ${attr}="${value}">@x</span>`;

describe('extractMentionedUserIds', () => {
  it('pulls ids out and dedupes them', () => {
    const html = `${span('data-user-id', 'u-1')} ${span('data-user-id', 'u-2')} ${span('data-user-id', 'u-1')}`;

    expect(extractMentionedUserIds(html)).toEqual(['u-1', 'u-2']);
  });

  it('ignores email mentions entirely', () => {
    // The two attributes must never cross: these ids are compared against uuid
    // columns, so an address here would throw 22P02 or silently match nothing.
    expect(
      extractMentionedUserIds(span('data-invite-email', 'a@b.test')),
    ).toEqual([]);
  });
});

describe('extractMentionedEmails', () => {
  it('pulls addresses out, lowercases and dedupes', () => {
    const html = `${span('data-invite-email', 'Alice@Example.com')} ${span('data-invite-email', 'bob@example.com')} ${span('data-invite-email', 'alice@example.com')}`;

    expect(extractMentionedEmails(html)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('ignores user-id mentions entirely', () => {
    expect(extractMentionedEmails(span('data-user-id', 'u-1'))).toEqual([]);
  });

  it.each([
    ['not-an-email'],
    ['@example.com'],
    ['alice@'],
    ['alice@example'],
    ['alice example@test.com'],
    [''],
    ['   '],
  ])('rejects %p', (value) => {
    expect(extractMentionedEmails(span('data-invite-email', value))).toEqual(
      [],
    );
  });

  it('rejects an address longer than RFC 5321 allows', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;

    expect(extractMentionedEmails(span('data-invite-email', tooLong))).toEqual(
      [],
    );
  });

  it('rejects a uuid smuggled into the email attribute', () => {
    // Belt and braces against the two attributes being confused.
    expect(
      extractMentionedEmails(
        span('data-invite-email', '11111111-2222-3333-4444-555555555555'),
      ),
    ).toEqual([]);
  });

  it('caps how many strangers one comment can invite', () => {
    const html = Array.from({ length: 12 }, (_, i) =>
      span('data-invite-email', `p${i}@example.com`),
    ).join(' ');

    expect(extractMentionedEmails(html)).toHaveLength(
      MAX_EMAIL_MENTIONS_PER_COMMENT,
    );
  });

  it('drops anything carrying a newline', () => {
    // These strings become the `to:` of an outbound message; a CR or LF is the
    // classic header-injection primitive.
    expect(
      extractMentionedEmails(
        span('data-invite-email', 'alice@example.com\r\nBcc: victim@x.test'),
      ),
    ).toEqual([]);
  });
});

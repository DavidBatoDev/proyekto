import { buildInvoiceEmailHtml } from '../../../modules/invoices/invoice-email.template';
import { buildInviteEmail } from '../../../modules/projects/project-invite-email.template';

/**
 * Byte-for-byte guard on the two branded email bodies.
 *
 * These snapshots are seeded from the output BEFORE the shared-layout
 * extraction, so they encode the look as it shipped. Extracting a common layout
 * is meant to be a pure refactor: if a snapshot moves, the layout is wrong, not
 * the template. Do not re-record to make a diff go away — read the diff.
 *
 * They also pin the escaping, which is the security-relevant half: every input
 * below carries markup that must come out inert.
 */
describe('branded email templates', () => {
  describe('buildInviteEmail', () => {
    it('renders a full invitation', () => {
      const body = buildInviteEmail({
        inviterName: 'Ada Lovelace',
        projectName: 'Analytical Engine',
        inviteLink: 'https://app.proyekto.test/freelancer/invites',
        invitedPosition: 'Lead Engineer',
        inviteMessage: 'Would love your help on the punch-card pipeline.',
        inviterAvatarUrl: 'https://cdn.proyekto.test/avatars/ada.png',
      });

      expect(body.subject).toMatchSnapshot('subject');
      expect(body.html).toMatchSnapshot('html');
      expect(body.text).toMatchSnapshot('text');
    });

    it('renders a minimal invitation (no position, message or avatar)', () => {
      const body = buildInviteEmail({
        inviterName: 'Ada Lovelace',
        projectName: 'Analytical Engine',
        inviteLink: 'https://app.proyekto.test/freelancer/invites',
      });

      expect(body.subject).toMatchSnapshot('subject');
      expect(body.html).toMatchSnapshot('html');
      expect(body.text).toMatchSnapshot('text');
    });

    it('escapes markup in every caller-supplied field', () => {
      const body = buildInviteEmail({
        inviterName: '<script>alert(1)</script>',
        projectName: '<img src=x onerror=alert(2)>',
        inviteLink: 'https://app.proyekto.test/freelancer/invites',
        invitedPosition: '"><b>bold</b>',
        inviteMessage: '<iframe src="evil"></iframe>',
        // Non-http scheme: must not be embedded at all.
        inviterAvatarUrl: 'javascript:alert(3)',
      });

      // The property is that no LIVE markup survives. The payload text may
      // still appear escaped — asserting on substrings like `onerror=` alone
      // would fail for the wrong reason, since `&lt;img ... onerror=...&gt;`
      // is inert.
      expect(body.html).not.toContain('<script>');
      expect(body.html).not.toContain('<img src=x');
      expect(body.html).not.toContain('<iframe');
      expect(body.html).toContain('&lt;script&gt;');
      expect(body.html).toContain('&lt;img src=x');
      // A non-http avatar scheme is dropped entirely rather than escaped.
      expect(body.html).not.toContain('javascript:');
      expect(body.html).toMatchSnapshot('html');
    });
  });

  describe('buildInvoiceEmailHtml', () => {
    const invoice = {
      id: 'inv-1',
      number: 'INV-2026-0001',
      total: 4200.5,
      currency: 'USD',
      due_date: '2026-09-01',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      issued_by: { name: 'Acme Studio', email: 'billing@acme.test' },
    };

    it('renders with an attachment', () => {
      const html = buildInvoiceEmailHtml({
        invoice: invoice as never,
        link: 'https://app.proyekto.test/invoices/inv-1',
        hasAttachment: true,
      });

      expect(html).toMatchSnapshot();
    });

    it('renders without an attachment', () => {
      const html = buildInvoiceEmailHtml({
        invoice: invoice as never,
        link: 'https://app.proyekto.test/invoices/inv-1',
        hasAttachment: false,
      });

      expect(html).toMatchSnapshot();
    });

    it('renders with no due date or period', () => {
      const html = buildInvoiceEmailHtml({
        invoice: {
          ...invoice,
          due_date: null,
          period_start: null,
          period_end: null,
        } as never,
        link: 'https://app.proyekto.test/invoices/inv-1',
        hasAttachment: false,
      });

      expect(html).toMatchSnapshot();
    });

    it('escapes markup in the provider name', () => {
      const html = buildInvoiceEmailHtml({
        invoice: {
          ...invoice,
          issued_by: { name: '<script>alert(1)</script>', email: 'x@y.test' },
        } as never,
        link: 'https://app.proyekto.test/invoices/inv-1',
        hasAttachment: false,
      });

      expect(html).not.toContain('<script>');
      expect(html).toMatchSnapshot();
    });
  });
});

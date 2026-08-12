import { buildInvoiceEmailHtml } from '../../../modules/marketplace/invoices/invoice-email.template';
import { buildInviteEmail } from '../../../modules/execution/projects/project-invite-email.template';

/**
 * Byte-for-byte guard on the two branded email bodies.
 *
 * Re-recorded when both templates were folded into the shared layout, so they
 * now encode the unified design rather than the two near-copies that preceded
 * it. From here they are a refactor guard again: if a snapshot moves, the
 * layout changed, and the diff is the thing to read — do not re-record to make
 * it go away.
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
        inviteLink: 'https://app.proyekto.test/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
        invitedPosition: 'Lead Engineer',
        inviteMessage: 'Would love your help on the punch-card pipeline.',
      });

      expect(body.subject).toMatchSnapshot('subject');
      expect(body.html).toMatchSnapshot('html');
      expect(body.text).toMatchSnapshot('text');
    });

    it('renders a minimal invitation (no position, message or avatar)', () => {
      const body = buildInviteEmail({
        inviterName: 'Ada Lovelace',
        projectName: 'Analytical Engine',
        inviteLink: 'https://app.proyekto.test/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      });

      expect(body.subject).toMatchSnapshot('subject');
      expect(body.html).toMatchSnapshot('html');
      expect(body.text).toMatchSnapshot('text');
    });

    it('escapes markup in every caller-supplied field', () => {
      const body = buildInviteEmail({
        inviterName: '<script>alert(1)</script>',
        projectName: '<img src=x onerror=alert(2)>',
        inviteLink: 'https://app.proyekto.test/invites?inviteId=6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
        invitedPosition: '"><b>bold</b>',
        inviteMessage: '<iframe src="evil"></iframe>',
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

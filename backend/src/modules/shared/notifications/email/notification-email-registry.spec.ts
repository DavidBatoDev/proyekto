import {
  EMAILABLE_NOTIFICATION_TYPES,
  canRenderNotificationEmail,
  renderNotificationEmail,
  type NotificationEmailContext,
} from './notification-email-registry';

describe('notification email registry', () => {
  const ctx: NotificationEmailContext = {
    content: {
      actor_name: 'Ada Lovelace',
      context_title: 'Design the login page',
      excerpt: 'Can you take a look at the spacing here?',
      message: 'You were mentioned in a task comment.',
    },
    linkUrl: '/project/p-1/roadmap/r-1?nodeId=t-1',
    appUrl: 'https://www.proyekto.test',
    unsubscribeUrl:
      'https://api.proyekto.test/api/notifications/unsubscribe?token=t',
    recipientName: 'Grace',
  };

  it('renders every emailable type without throwing', () => {
    for (const type of EMAILABLE_NOTIFICATION_TYPES) {
      const email = renderNotificationEmail(type, ctx);
      expect(email).not.toBeNull();
      expect(email?.subject.length).toBeGreaterThan(0);
      expect(email?.html).toContain('<!DOCTYPE html>');
      expect(email?.text.length).toBeGreaterThan(0);
    }
  });

  it('fails closed for an unmapped type', () => {
    // The database flag and this table are two switches that must agree. If a
    // type is marked email_eligible with no template, the answer is "send
    // nothing", never "send an empty shell".
    expect(canRenderNotificationEmail('invoice_issued')).toBe(false);
    expect(renderNotificationEmail('invoice_issued', ctx)).toBeNull();
  });

  it('names the actor and quotes the excerpt', () => {
    const email = renderNotificationEmail('task_comment_mention', ctx);

    expect(email?.subject).toBe(
      'Ada Lovelace mentioned you in Design the login page',
    );
    expect(email?.html).toContain('Ada Lovelace');
    expect(email?.html).toContain('Can you take a look at the spacing here?');
    expect(email?.text).toContain('"Can you take a look at the spacing here?"');
  });

  it('degrades gracefully when the content blob is bare', () => {
    // Old notifications predate the enrichment, and `content` is free-form
    // jsonb that nothing validates — a missing actor must not render "undefined
    // mentioned you".
    const email = renderNotificationEmail('chat_mention', {
      ...ctx,
      content: {},
    });

    expect(email?.subject).toBe('Someone mentioned you in chat');
    expect(email?.html).not.toContain('undefined');
    expect(email?.html).not.toContain('null');
  });

  it('makes a relative link absolute', () => {
    const email = renderNotificationEmail('task_comment_mention', ctx);

    expect(email?.html).toContain(
      'https://www.proyekto.test/project/p-1/roadmap/r-1?nodeId=t-1',
    );
    // No protocol-relative or bare-path hrefs — useless in an inbox.
    expect(email?.html).not.toContain('href="/project');
  });

  it('leaves an already-absolute link alone', () => {
    const email = renderNotificationEmail('task_comment_mention', {
      ...ctx,
      linkUrl: 'https://elsewhere.test/x',
    });

    expect(email?.html).toContain('https://elsewhere.test/x');
  });

  it('escapes markup arriving through content', () => {
    // `excerpt` is a snapshot of a user-authored comment and `actor_name` comes
    // from a profile — both are attacker-influenced.
    const email = renderNotificationEmail('task_comment_mention', {
      ...ctx,
      content: {
        actor_name: '<script>alert(1)</script>',
        context_title: '<img src=x onerror=alert(2)>',
        excerpt: '<iframe src="evil"></iframe>',
      },
    });

    expect(email?.html).not.toContain('<script>');
    expect(email?.html).not.toContain('<iframe');
    expect(email?.html).not.toContain('<img src=x');
    expect(email?.html).toContain('&lt;script&gt;');
  });

  describe('chat_dm_received', () => {
    const dmCtx = {
      ...ctx,
      content: {
        actor_name: 'Ada Lovelace',
        excerpt: 'are you free at 3?',
        message: 'Ada Lovelace sent you a message',
      },
      linkUrl: '/inbox?r=room-1',
    };

    it('reads as a message, not a mention', () => {
      const email = renderNotificationEmail('chat_dm_received', dmCtx);

      expect(email?.subject).toBe('Ada Lovelace sent you a message');
      expect(email?.html).toContain('New direct message');
      expect(email?.html).toContain('Open conversation');
      expect(email?.html).toContain('are you free at 3?');
    });

    it('never claims the reader was mentioned', () => {
      // The footer sits directly beside the unsubscribe link — the one place the
      // email has to be straight about why it arrived.
      const email = renderNotificationEmail('chat_dm_received', dmCtx);

      expect(email?.html).toContain('unread direct message');
      expect(email?.html).not.toContain('you were mentioned');
    });

    it('preserves the ?r= query string in the deep link', () => {
      const email = renderNotificationEmail('chat_dm_received', dmCtx);

      expect(email?.html).toContain('https://www.proyekto.test/inbox?r=room-1');
    });

    it('degrades to "Someone" with a bare content blob', () => {
      const email = renderNotificationEmail('chat_dm_received', {
        ...dmCtx,
        content: {},
      });

      expect(email?.subject).toBe('Someone sent you a message');
      expect(email?.html).not.toContain('undefined');
    });

    it('omits the "in <context>" clause entirely', () => {
      // The DM producer sets no context_title on purpose; with one the copy
      // would read "sent you a message in a direct message".
      const email = renderNotificationEmail('chat_dm_received', dmCtx);

      expect(email?.html).not.toContain(' in a direct message');
    });
  });

  describe('roadmap_mention_invite (recipient has no account)', () => {
    const inviteCtx = {
      ...ctx,
      content: {
        actor_name: 'Ada Lovelace',
        context_title: 'Redesign the onboarding',
        // The producer omits `excerpt` deliberately. Present here to prove the
        // renderer would quote it if it ever arrived, so the guarantee has to
        // come from the producer AND be asserted below.
        excerpt: 'the client hated the third screen',
      },
      linkUrl: '/auth/signup?redirect=%2Finvites&email=alice%40example.com',
    };

    it('sends them to signup, not to a comment they cannot open', () => {
      const email = renderNotificationEmail('roadmap_mention_invite', {
        ...inviteCtx,
        content: { actor_name: 'Ada Lovelace' },
      });

      expect(email?.html).toContain('Create your account');
      expect(email?.html).toContain(
        'https://www.proyekto.test/auth/signup?redirect=%2Finvites&amp;email=alice%40example.com',
      );
      // A roadmap deep link would 403 until they accept the invite.
      expect(email?.html).not.toContain('/project/');
    });

    it('orients someone who has never heard of Proyekto', () => {
      const email = renderNotificationEmail('roadmap_mention_invite', {
        ...inviteCtx,
        content: { actor_name: 'Ada Lovelace' },
      });

      expect(email?.html).toContain('Proyekto is where teams plan');
      expect(email?.html).toContain('unsubscribe below');
      // The mention footer would claim they were "mentioned on Proyekto",
      // implying an account they do not have.
      expect(email?.html).not.toContain('you were mentioned on Proyekto');
    });

    it('leaks no comment text when the producer omits the excerpt', () => {
      // Pins the privacy decision: an address that has proven nothing — and may
      // be a typo — must not receive a slice of a private project thread.
      const email = renderNotificationEmail('roadmap_mention_invite', {
        ...inviteCtx,
        content: { actor_name: 'Ada Lovelace', context_title: 'Redesign' },
      });

      expect(email?.html).not.toContain('the client hated the third screen');
      expect(email?.html).not.toContain('white-space:pre-wrap');
    });
  });

  describe('time emails (activated by M1)', () => {
    const TIME_EMAIL_TYPES = [
      'timesheet_submitted',
      'timesheet_returned',
      'timesheet_reminder',
      'time_payout_recorded',
    ] as const;

    const sheetCtx = (
      message: string,
      extra: Record<string, unknown> = {},
    ): NotificationEmailContext => ({
      ...ctx,
      content: {
        timesheet_id: 'sheet-1',
        scope_kind: 'team',
        team_id: 'team-1',
        period_start: '2026-09-22',
        period_end: '2026-09-28',
        total_seconds: 137700,
        context_title: 'Acme Team',
        message,
        ...extra,
      },
      linkUrl: '/time/timesheets/sheet-1',
    });

    it('can render all four', () => {
      for (const type of TIME_EMAIL_TYPES) {
        expect(canRenderNotificationEmail(type)).toBe(true);
      }
    });

    it('leads with content.message and links back to the timesheet', () => {
      const email = renderNotificationEmail(
        'timesheet_submitted',
        sheetCtx('Maria sent 38h 15m for Acme Team · Sep 22–28', {
          actor_name: 'Maria',
        }),
      );

      expect(email?.subject).toBe('Maria sent a timesheet to review');
      expect(email?.html).toContain('Timesheet to review');
      expect(email?.html).toContain(
        'Maria sent 38h 15m for Acme Team · Sep 22–28.',
      );
      expect(email?.html).toContain('Review timesheet');
      expect(email?.html).toContain(
        'https://www.proyekto.test/time/timesheets/sheet-1',
      );
      expect(email?.text).toContain(
        'Review timesheet: https://www.proyekto.test/time/timesheets/sheet-1',
      );
      expect(email?.html).toContain('you approve time on Proyekto');
    });

    it('returned and reminder emails speak to the person who tracks the time', () => {
      const returned = renderNotificationEmail(
        'timesheet_returned',
        sheetCtx('Ana returned Sep 22–28 for Acme Team: "Split Thursday"'),
      );
      expect(returned?.subject).toBe('Your timesheet was returned');
      expect(returned?.html).toContain('Split Thursday');
      expect(returned?.html).toContain('you track time on Proyekto');

      const reminder = renderNotificationEmail(
        'timesheet_reminder',
        sheetCtx('Your Acme Team timesheet for Sep 22–28 is ready to submit'),
      );
      expect(reminder?.subject).toBe('Time to submit your timesheet');
      expect(reminder?.text).toContain(
        'Your Acme Team timesheet for Sep 22–28 is ready to submit.',
      );
    });

    it('the payout email names no amount and no currency (CHANGE-19)', () => {
      // A producer bug that put figures into other content keys must still not
      // reach the inbox: only `message` is rendered, and the time spec pins it.
      const email = renderNotificationEmail('time_payout_recorded', {
        ...ctx,
        content: {
          payout_id: 'payout-1',
          entry_count: 3,
          message: 'A payment was recorded for your time',
          total_amount: 4321.99,
          currency: 'USD',
        },
        linkUrl: '/teams/team-1/time/my-logs',
      });

      expect(email?.subject).toBe('A payment was recorded for your time');
      for (const part of [email?.subject, email?.html, email?.text]) {
        expect(part).not.toContain('4321');
        expect(part).not.toContain('USD');
        expect(part).not.toMatch(/[$€£¥₱]/);
      }
    });

    it('degrades to a sentence when the content blob is bare', () => {
      for (const type of TIME_EMAIL_TYPES) {
        const email = renderNotificationEmail(type, {
          ...ctx,
          content: {},
          linkUrl: null,
        });
        expect(email?.subject.length).toBeGreaterThan(0);
        expect(email?.html).not.toContain('undefined');
        expect(email?.html).not.toContain('null');
        expect(email?.text).toContain('https://www.proyekto.test');
      }
      expect(
        renderNotificationEmail('timesheet_submitted', {
          ...ctx,
          content: {},
        })?.subject,
      ).toBe('A timesheet is waiting for your review');
    });

    it('escapes markup arriving through the message', () => {
      // The message embeds a decision note and display names, both user-authored.
      const email = renderNotificationEmail(
        'timesheet_returned',
        sheetCtx('Ana returned Sep 22–28: "<script>alert(1)</script>"'),
      );

      expect(email?.html).not.toContain('<script>');
      expect(email?.html).toContain('&lt;script&gt;');
    });
  });

  it('includes the unsubscribe link, and omits it when absent', () => {
    expect(
      renderNotificationEmail('task_comment_mention', ctx)?.html,
    ).toContain('Unsubscribe from these emails');
    expect(
      renderNotificationEmail('task_comment_mention', {
        ...ctx,
        unsubscribeUrl: null,
      })?.html,
    ).not.toContain('Unsubscribe from these emails');
  });
});

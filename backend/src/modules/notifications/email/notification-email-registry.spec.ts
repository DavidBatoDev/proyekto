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

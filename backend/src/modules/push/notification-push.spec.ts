import { buildPushMessage } from './notification-push';

describe('buildPushMessage', () => {
  const base = { notificationId: 'n-1', typeName: 'task_comment_mention' };

  it('titles by type and takes the body from content.message', () => {
    const msg = buildPushMessage({
      ...base,
      content: { message: 'You were mentioned in a task comment.' },
    });

    expect(msg.title).toBe('You were mentioned');
    expect(msg.body).toBe('You were mentioned in a task comment.');
  });

  it('falls back to the brand title for an unmapped type', () => {
    const msg = buildPushMessage({ ...base, typeName: 'something_new' });

    expect(msg.title).toBe('Proyekto');
    expect(msg.body).toBe('You have a new notification.');
  });

  it('passes scalar ids through so a tap can route', () => {
    const msg = buildPushMessage({
      ...base,
      content: { message: 'hi', task_id: 't-1', comment_id: 'c-1' },
      linkUrl: '/project/p-1/roadmap/r-1',
      projectId: 'p-1',
    });

    expect(msg.data).toMatchObject({
      notification_id: 'n-1',
      type: 'task_comment_mention',
      link_url: '/project/p-1/roadmap/r-1',
      project_id: 'p-1',
      task_id: 't-1',
      comment_id: 'c-1',
    });
  });

  it('keeps presentation-only keys out of the FCM data map', () => {
    // `excerpt` is up to 280 chars of prose and nothing can act on it, so it
    // must not eat into the 4KB payload budget. Regression guard for the
    // pass-through loop, which previously copied every scalar except `message`.
    const msg = buildPushMessage({
      ...base,
      content: {
        message: 'You were mentioned in a task comment.',
        excerpt: 'x'.repeat(280),
        actor_name: 'Ada Lovelace',
        context_title: 'Design the login page',
        task_id: 't-1',
      },
    });

    expect(msg.data).not.toHaveProperty('excerpt');
    expect(msg.data).not.toHaveProperty('actor_name');
    expect(msg.data).not.toHaveProperty('context_title');
    expect(msg.data).not.toHaveProperty('message');
    // ...while the actionable id still rides along.
    expect(msg.data).toMatchObject({ task_id: 't-1' });
  });

  it('drops non-scalar content values', () => {
    const msg = buildPushMessage({
      ...base,
      content: { message: 'hi', changes: [{ field: 'status' }], meta: null },
    });

    expect(msg.data).not.toHaveProperty('changes');
    expect(msg.data).not.toHaveProperty('meta');
  });
});

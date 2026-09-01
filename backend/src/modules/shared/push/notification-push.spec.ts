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

  it('leads a DM with the sender and what they actually said', () => {
    const msg = buildPushMessage({
      notificationId: 'n-1',
      typeName: 'chat_dm_received',
      content: {
        message: 'Ada: are you free at 3?',
        room_id: 'room-1',
        message_id: 'msg-1',
        excerpt: 'are you free at 3?',
        actor_name: 'Ada',
      },
      linkUrl: '/inbox?r=room-1',
    });

    // This REVERSES the previous rule that the body carry no message text
    // ("nothing should leak to a lock screen"). The lock screen is protected a
    // layer down instead: chat is routed to the proyekto_chat Android channel,
    // created with visibility: Private, so the text shows in the shade but not
    // on a locked device. The excerpt is no longer email-only.
    expect(msg.title).toBe('Ada');
    expect(msg.body).toBe('are you free at 3?');
    // Still kept out of the machine payload — it is prose, and the data map has
    // a 4KB budget.
    expect(msg.data).not.toHaveProperty('excerpt');
    expect(msg.data).toMatchObject({
      room_id: 'room-1',
      message_id: 'msg-1',
      link_url: '/inbox?r=room-1',
    });
    // Groups by conversation without collapsing, so a burst stacks.
    expect(msg.threadKey).toBe('chat:room-1');
  });

  it('names the channel in the title of a channel message', () => {
    const msg = buildPushMessage({
      notificationId: 'n-2',
      typeName: 'chat_message_received',
      content: {
        message: 'Ada in #general: deploy is green',
        room_id: 'room-2',
        excerpt: 'deploy is green',
        actor_name: 'Ada',
        room_label: '#general',
      },
    });

    expect(msg.title).toBe('Ada in #general');
    expect(msg.body).toBe('deploy is green');
    // room_label is presentation-only; it must not reach the data map.
    expect(msg.data).not.toHaveProperty('room_label');
  });

  it('falls back to the old summary when a chat row has no actor', () => {
    const msg = buildPushMessage({
      notificationId: 'n-3',
      typeName: 'chat_dm_received',
      content: { message: 'Someone sent you a message', room_id: 'room-3' },
    });

    expect(msg.title).toBe('New message');
    expect(msg.body).toBe('Someone sent you a message');
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

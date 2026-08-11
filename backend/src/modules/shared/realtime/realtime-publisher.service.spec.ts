import { ConfigService } from '@nestjs/config';
import { RealtimePublisher } from './realtime-publisher.service';

describe('RealtimePublisher', () => {
  const buildConfig = (values: Record<string, unknown>): ConfigService =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op when worker URL / token are not configured', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const publisher = new RealtimePublisher(buildConfig({}));

    publisher.publishRoadmapChange('roadmap-1', 'user-1');
    publisher.publishChatEvent({
      recipientIds: ['user-2'],
      roomId: 'room-1',
      projectId: 'project-1',
      kind: 'message',
    });

    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a roadmap data_changed event with from=userId', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const publisher = new RealtimePublisher(
      buildConfig({
        REALTIME_WORKER_URL: 'https://realtime.example/',
        REALTIME_PUBLISH_TOKEN: 'tok',
      }),
    );

    publisher.publishRoadmapChange('roadmap-1', 'user-1');
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://realtime.example/publish'); // trailing slash trimmed
    expect((init as RequestInit).method).toBe('POST');
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ 'x-realtime-token': 'tok' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      room: 'roadmap:roadmap-1',
      event: 'data_changed',
      payload: { from: 'user-1' },
    });
  });

  it('fans a chat event out to each unique recipient inbox', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const publisher = new RealtimePublisher(
      buildConfig({
        REALTIME_WORKER_URL: 'https://realtime.example',
        REALTIME_PUBLISH_TOKEN: 'tok',
      }),
    );

    publisher.publishChatEvent({
      recipientIds: ['a', 'b', 'a', ''], // dedup + skip empty
      roomId: 'room-1',
      projectId: null,
      kind: 'message',
    });
    await Promise.resolve();

    const rooms = fetchSpy.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).room,
    );
    expect(rooms.sort()).toEqual(['user:a', 'user:b']);
  });

  it('never throws when the worker call fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    const publisher = new RealtimePublisher(
      buildConfig({
        REALTIME_WORKER_URL: 'https://realtime.example',
        REALTIME_PUBLISH_TOKEN: 'tok',
      }),
    );

    expect(() => publisher.publishRoadmapChange('roadmap-1')).not.toThrow();
    await Promise.resolve();
  });
});

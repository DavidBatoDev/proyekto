import { ConfigService } from '@nestjs/config';
import { RoadmapMetadataGeneratorService } from './roadmap-metadata-generator.service';

describe('RoadmapMetadataGeneratorService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(apiKey: string | null = 'test-key') {
    const config = {
      get: jest.fn((key: string) =>
        key === 'OPENAI_API_KEY' ? (apiKey ?? undefined) : undefined,
      ),
    } as unknown as ConfigService;

    return new RoadmapMetadataGeneratorService(config);
  }

  function mockFetchResponse(content: string, ok = true) {
    fetchMock = jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: jest.fn().mockResolvedValue({
        choices: [{ message: { content } }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  it('returns sanitized metadata from OpenAI JSON', async () => {
    mockFetchResponse(
      JSON.stringify({
        name: '  Fitness Coaching App! ',
        description:
          'A guided roadmap for launching a coaching app with workouts, tracking, and retention.',
        category: 'Mobile App',
      }),
    );

    const service = createService();
    const result = await service.suggest({
      prompt: 'Build a fitness mobile app',
    });

    expect(result).toEqual({
      name: 'Fitness Coaching App',
      description:
        'A guided roadmap for launching a coaching app with workouts, tracking, and retention.',
      category: 'Mobile App',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when OPENAI_API_KEY is missing', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService(null);
    const result = await service.suggest({
      prompt: 'Build a dashboard for managing subscriptions',
    });

    expect(result).toEqual({
      name: 'Build a dashboard for managing subscriptions',
      description:
        'Roadmap for Build a dashboard for managing subscriptions.',
      category: 'SaaS',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back when OpenAI returns invalid JSON', async () => {
    mockFetchResponse('not-json');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const service = createService();
    const result = await service.suggest({
      prompt: 'Build an AI chatbot for customer support',
    });

    expect(result).toEqual({
      name: 'Build an AI chatbot for customer support',
      description: 'Roadmap for Build an AI chatbot for customer support.',
      category: 'AI / ML',
    });
  });

  it('uses a safe fallback for empty prompts', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService();
    const result = await service.suggest({ prompt: '   ' });

    expect(result).toEqual({
      name: 'New Roadmap',
      description:
        'A structured roadmap for turning an idea into an actionable plan.',
      category: 'Web Development',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns sanitized title options from OpenAI JSON', async () => {
    mockFetchResponse(
      JSON.stringify({
        assistant_message:
          'Before we start, what would you like to call this roadmap?',
        options: [
          { key: 'A', value: '  Fitness Buddy! ' },
          { key: 'B', value: 'Workout Companion Roadmap.' },
          { key: 'C', value: 'Health Tracking Launch Plan' },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'title',
      prompt: 'I want to create a fitness app',
    });

    expect(result).toEqual({
      assistant_message:
        'Before we start, what would you like to call this roadmap?',
      options: [
        { key: 'A', value: 'Fitness Buddy' },
        { key: 'B', value: 'Workout Companion Roadmap' },
        { key: 'C', value: 'Health Tracking Launch Plan' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces low-quality echoed title options', async () => {
    mockFetchResponse(
      JSON.stringify({
        assistant_message: 'What should we call this roadmap?',
        options: [
          { key: 'A', value: 'I want to build a fitness web app' },
          { key: 'B', value: 'I want to build a fitness web app Launch Plan' },
          { key: 'C', value: 'I want to build a fitness web app Roadmap' },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'title',
      prompt: 'I want to build a fitness web app',
    });

    expect(result.options).toEqual([
      { key: 'A', value: 'FitFlow Studio' },
      { key: 'B', value: 'PulseCoach Platform' },
      { key: 'C', value: 'Momentum Fitness Hub' },
    ]);
  });

  it('returns sanitized description options and category suggestions', async () => {
    mockFetchResponse(
      JSON.stringify({
        assistant_message:
          'What is the goal of this roadmap? Choose a direction or write your own.',
        options: [
          {
            key: 'A',
            value:
              'Plan onboarding, workout logging, analytics, and retention for Fitness Buddy.',
          },
          {
            key: 'B',
            value:
              'Define the MVP features needed to launch a fitness companion app.',
          },
          {
            key: 'C',
            value:
              'Map the product, backend, and mobile delivery phases for the app.',
          },
        ],
        category_suggestions: [
          'Health & Fitness',
          'Mobile App',
          'SaaS',
          'Mobile App',
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'description',
      prompt: 'I want to create a fitness app',
      title: 'Fitness Buddy',
    });

    expect(result.assistant_message).toBe(
      'What is the goal of this roadmap? Choose a direction or write your own.',
    );
    expect(result.options).toEqual([
      {
        key: 'A',
        value:
          'Plan onboarding, workout logging, analytics, and retention for Fitness Buddy.',
      },
      {
        key: 'B',
        value: 'Define the MVP features needed to launch a fitness companion app.',
      },
      {
        key: 'C',
        value:
          'Map the product, backend, and mobile delivery phases for the app.',
      },
    ]);
    expect(result.category_suggestions).toEqual([
      'Health & Fitness',
      'Mobile App',
      'SaaS',
      'Web Development',
      'AI / ML',
    ]);
  });

  it('falls back safely when intake JSON is invalid', async () => {
    mockFetchResponse('not-json');

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'title',
      prompt: 'Build an AI chatbot for customer support',
    });

    expect(result.options).toEqual([
      { key: 'A', value: 'SmartFlow Assistant' },
      { key: 'B', value: 'AI Launch Blueprint' },
      { key: 'C', value: 'Automation Command Center' },
    ]);
  });
});

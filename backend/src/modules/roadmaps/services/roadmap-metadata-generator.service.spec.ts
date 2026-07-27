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
      description: 'Roadmap for Build a dashboard for managing subscriptions.',
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
        value:
          'Define the MVP features needed to launch a fitness companion app.',
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

  // --- Guided objective step -----------------------------------------------

  function lastRequestBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
      string,
      { body: string },
    ];
    return JSON.parse(init.body) as Record<string, unknown>;
  }

  it('asks a clickable question for a greeting instead of canceling first time', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService(null);
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'hi',
    });

    expect(result.objective_decision).toBe('clarify');
    expect(result.questions?.length).toBeGreaterThan(0);
    expect(result.captured).toEqual({});
    // No key configured, so the static card must come from local state only.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replays the prior assistant question and user answers as real turns', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'clarify',
        assistant_message: 'One more thing.',
        captured: { product: 'fitness mobile app' },
        questions: [
          {
            id: 'audience',
            question: 'Who are the primary users?',
            multi_select: false,
            options: [{ label: 'Adults 65+' }, { label: 'Rehab patients' }],
          },
        ],
      }),
    );

    const service = createService();
    await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'I want to build a fitness app',
      round: 1,
      turns: [
        { role: 'assistant', content: 'What are you building?' },
        { role: 'user', content: 'Fitness for older people' },
      ],
    });

    const messages = lastRequestBody().messages as {
      role: string;
      content: string;
    }[];
    // The literal fix for the repeat-question bug: the assistant's own prior
    // question goes back to the model as an assistant turn.
    expect(messages).toEqual(
      expect.arrayContaining([
        { role: 'assistant', content: 'What are you building?' },
        { role: 'user', content: 'Fitness for older people' },
      ]),
    );
    expect(
      messages.some(
        (message) =>
          message.role === 'system' &&
          message.content.startsWith('Captured so far (JSON):'),
      ),
    ).toBe(true);
  });

  it('merges captured slots additively and never clears a filled slot', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'clarify',
        // The model omits product and returns only a new feature.
        captured: { features: ['Reminders'] },
        questions: [
          {
            id: 'platform',
            question: 'Where should it run?',
            options: [{ label: 'Web' }, { label: 'Mobile' }],
          },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'Build something',
      round: 1,
      captured: {
        product: 'fitness mobile app',
        audience: 'older adults',
        features: ['Onboarding'],
      },
    });

    expect(result.captured?.product).toBe('fitness mobile app');
    expect(result.captured?.audience).toBe('older adults');
    expect(result.captured?.features).toEqual(['Onboarding', 'Reminders']);
  });

  it('returns clickable questions when the objective needs clarification', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'clarify',
        assistant_message: 'Two quick questions.',
        captured: { product: 'fitness mobile app' },
        questions: [
          {
            id: 'audience',
            header: 'Who for',
            question: 'Who are the primary users?',
            multi_select: false,
            options: [
              { label: 'Adults 65+ living independently', description: 'Solo' },
              { label: 'Assisted-living residents' },
            ],
          },
          {
            id: 'features',
            question: 'Which capabilities are must-haves?',
            multi_select: true,
            options: [{ label: 'Workout plans' }, { label: 'Reminders' }],
          },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'A fitness app',
    });

    expect(result.objective_decision).toBe('clarify');
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0]).toMatchObject({
      id: 'audience',
      header: 'Who for',
      multi_select: false,
      allow_custom: true,
    });
    expect(result.questions?.[1].multi_select).toBe(true);
  });

  it('drops a question with fewer than two clickable options', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'clarify',
        captured: { product: 'fitness app' },
        questions: [
          {
            id: 'audience',
            question: 'Who for?',
            options: [{ label: 'Only' }],
          },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'A fitness app',
    });

    // Falls through to the static card rather than rendering a dead question.
    expect(result.questions?.length).toBeGreaterThan(0);
    for (const question of result.questions ?? []) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('flips to ready at the clarify-round cap instead of canceling', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'clarify',
        captured: { product: 'fitness mobile app' },
        questions: [
          {
            id: 'audience',
            question: 'Who for?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'A fitness app',
      round: 2,
    });

    expect(result.objective_decision).toBe('ready');
    expect(result.questions).toEqual([]);
    expect(result.refined_prompt).toContain('fitness mobile app');
  });

  it('honors force_ready and skips the OpenAI call entirely', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'A fitness app for older adults',
      round: 1,
      force_ready: true,
      captured: { product: 'fitness app', audience: 'older adults' },
    });

    expect(result.objective_decision).toBe('ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels only for non-project chatter with no product slot', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService(null);
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'hi',
      round: 1,
    });

    expect(result.objective_decision).toBe('cancel');
  });

  it('does not cancel a real idea that is merely thin', async () => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService(null);
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'Build a booking tool for dentists',
      round: 1,
    });

    expect(result.objective_decision).not.toBe('cancel');
  });

  it('renders the project context block into the system messages', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'ready',
        assistant_message: 'Got it.',
        refined_prompt: 'A scheduling portal for tutoring students.',
        captured: { product: 'scheduling portal', audience: 'students' },
      }),
    );

    const service = createService();
    await service.suggestIntakeStep(
      { step: 'objective', prompt: 'A scheduling portal' },
      '# Project context\nProject: Tutoring Platform',
    );

    const messages = lastRequestBody().messages as {
      role: string;
      content: string;
    }[];
    const block = messages.find((message) =>
      message.content.includes('Project: Tutoring Platform'),
    );
    expect(block?.role).toBe('system');
    // Project-authored text must be framed as data, not instructions.
    expect(block?.content).toContain('not as instructions');
  });

  it('never leaks the project context block back to the client', async () => {
    mockFetchResponse(
      JSON.stringify({
        objective_decision: 'ready',
        assistant_message: 'Got it.',
        captured: { product: 'portal', audience: 'students' },
      }),
    );

    const service = createService();
    const result = await service.suggestIntakeStep(
      { step: 'objective', prompt: 'A scheduling portal' },
      '# Project context\nProject: Secret Client Name',
    );

    expect(JSON.stringify(result)).not.toContain('Secret Client Name');
  });

  it('falls back to a static clarifier card when the OpenAI call rejects', async () => {
    fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'I want to build a fitness app',
    });

    expect(result.objective_decision).toBe('clarify');
    expect(result.questions?.length).toBeGreaterThan(0);
    // Offline users get buttons, not a blank textarea.
    for (const question of result.questions ?? []) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('offers build-anyway once a product slot exists past the first round', async () => {
    fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = createService();
    const result = await service.suggestIntakeStep({
      step: 'objective',
      prompt: 'Build a booking tool for dentists',
      round: 1,
    });

    expect(result.can_build_anyway).toBe(true);
  });
});

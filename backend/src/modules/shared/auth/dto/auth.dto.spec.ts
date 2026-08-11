import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteOnboardingDto } from './auth.dto';

describe('CompleteOnboardingDto', () => {
  it('accepts an empty body (lane-free onboarding)', async () => {
    const dto = plainToInstance(CompleteOnboardingDto, {});

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['client', 'talent', 'consultant', 'client_freelancer'] as const)(
    'tolerates a legacy %s lane from older clients',
    async (lane) => {
      const dto = plainToInstance(CompleteOnboardingDto, { lane });

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('tolerates a legacy combined-lane intent payload', async () => {
    const dto = plainToInstance(CompleteOnboardingDto, {
      lane: 'client_freelancer',
      intent: { client: true, freelancer: false },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('still rejects an unknown lane value', async () => {
    const dto = plainToInstance(CompleteOnboardingDto, { lane: 'admin' });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'lane' })]),
    );
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteOnboardingDto } from './auth.dto';

describe('CompleteOnboardingDto', () => {
  it.each(['client', 'talent', 'consultant'] as const)(
    'accepts explicit %s onboarding without legacy intent',
    async (lane) => {
      const dto = plainToInstance(CompleteOnboardingDto, { lane });

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it('requires intent for the legacy combined lane', async () => {
    const dto = plainToInstance(CompleteOnboardingDto, {
      lane: 'client_freelancer',
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'intent' })]),
    );
  });

  it('accepts a valid legacy combined-lane intent', async () => {
    const dto = plainToInstance(CompleteOnboardingDto, {
      lane: 'client_freelancer',
      intent: { client: true, freelancer: false },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});

// The DTO carries a class-transformer @Type decorator; the sibling service
// specs get reflect-metadata transitively through Nest, this one must ask.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTeamMemberRateDto } from './teams.dto';

/**
 * Clearing a rate's end date is how you reopen a closed rate as the current
 * one, and the service keys that behaviour off `end_date === null` exactly:
 * it is the trigger for closing any sibling open-ended row, which is what keeps
 * the partial unique index on (team, user, project) WHERE end_date IS NULL
 * satisfiable.
 *
 * The web used to send `undefined` here (`editEndDate || undefined`), which JSON
 * drops entirely — so "clear the end date" silently did nothing and the UI
 * reported success. These pin the contract that made that fix possible.
 */
describe('UpdateTeamMemberRateDto — end_date', () => {
  const validateDto = async (value: unknown) => {
    const dto = plainToInstance(UpdateTeamMemberRateDto, {
      end_date: value,
    } as Record<string, unknown>);
    return validate(dto);
  };

  it('accepts null, so the web can clear the date rather than omit the field', async () => {
    await expect(validateDto(null)).resolves.toHaveLength(0);
  });

  it('accepts a real date', async () => {
    await expect(validateDto('2026-09-30')).resolves.toHaveLength(0);
  });

  it('still rejects a non-date string — @IsOptional must not disable the check', async () => {
    const errors = await validateDto('not-a-date');
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('end_date');
  });
});

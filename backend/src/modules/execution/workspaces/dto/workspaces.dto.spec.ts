import 'reflect-metadata';
import { validate } from 'class-validator';
import { UpdateWorkspaceDto } from './workspaces.dto';

/**
 * A complimentary plan is staff-granted revenue given away, so the workspace's
 * own owners and admins must have no route to it. The database guards the
 * columns (workspaces_discount_guard, plus revoked UPDATE for authenticated);
 * this pins the API half: UpdateWorkspaceDto never declares a comp field, so
 * the global ValidationPipe (whitelist + forbidNonWhitelisted) turns any
 * attempt into a 400 instead of passing it through to the update.
 */
describe('UpdateWorkspaceDto — complimentary plan fields', () => {
  const validationOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  } as const;

  it.each<[string, unknown]>([
    ['is_discounted_free', true],
    ['discounted_plan', 'enterprise'],
    ['discounted_at', '2026-09-22T00:00:00Z'],
    ['discounted_until', null],
  ])('rejects %s in an update body', async (field, value) => {
    const dto = Object.assign(new UpdateWorkspaceDto(), {
      name: 'Acme',
      [field]: value,
    });

    const errors = await validate(dto, validationOptions);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('still accepts an ordinary rename', async () => {
    const dto = Object.assign(new UpdateWorkspaceDto(), { name: 'Acme' });
    await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
  });
});

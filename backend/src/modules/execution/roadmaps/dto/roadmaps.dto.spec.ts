import 'reflect-metadata';
import { validate } from 'class-validator';
import { MoveTaskDto, UpdateTaskDto } from './roadmaps.dto';

describe('task write DTO boundaries', () => {
  const validationOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
  } as const;

  it.each(['position', 'feature_id'])(
    'rejects %s on a generic task update',
    async (field) => {
      const dto = Object.assign(new UpdateTaskDto(), {
        title: 'Renamed task',
        [field]:
          field === 'position' ? 2 : '62e7079c-cf19-4e5e-b50b-b346faef8520',
      });

      const errors = await validate(dto, validationOptions);

      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it('accepts feature and position together on the dedicated move DTO', async () => {
    const dto = Object.assign(new MoveTaskDto(), {
      feature_id: '62e7079c-cf19-4e5e-b50b-b346faef8520',
      position: 2,
    });

    await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
  });
});

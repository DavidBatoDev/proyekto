import { BadRequestException } from '@nestjs/common';
import type { JsonPatchOperationDto } from '../dto/patch-roadmap.dto';

const ROOT_FIELDS = ['name', 'description', 'status', 'start_date', 'end_date'];
const ROOT_OBJECT_FIELDS = ['settings'];
const EPIC_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'position',
  'color',
  'start_date',
  'end_date',
  'tags',
];
const FEATURE_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'position',
  'is_deliverable',
  'start_date',
  'end_date',
];
const TASK_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'position',
  'due_date',
  'assignee_id',
];

const INDEX_SEGMENT = '(?:\\d+|-)';

const allowedPathPatterns: RegExp[] = [
  new RegExp(`^/(?:${ROOT_FIELDS.join('|')})$`),
  new RegExp(`^/(?:${ROOT_OBJECT_FIELDS.join('|')})$`),
  /^\/roadmap_epics$/,
  new RegExp(`^/roadmap_epics/${INDEX_SEGMENT}$`),
  new RegExp(`^/roadmap_epics/${INDEX_SEGMENT}/(?:${EPIC_FIELDS.join('|')})$`),
  new RegExp(`^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features$`),
  new RegExp(
    `^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features/${INDEX_SEGMENT}$`,
  ),
  new RegExp(
    `^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features/${INDEX_SEGMENT}/(?:${FEATURE_FIELDS.join('|')})$`,
  ),
  new RegExp(
    `^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features/${INDEX_SEGMENT}/roadmap_tasks$`,
  ),
  new RegExp(
    `^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features/${INDEX_SEGMENT}/roadmap_tasks/${INDEX_SEGMENT}$`,
  ),
  new RegExp(
    `^/roadmap_epics/${INDEX_SEGMENT}/roadmap_features/${INDEX_SEGMENT}/roadmap_tasks/${INDEX_SEGMENT}/(?:${TASK_FIELDS.join('|')})$`,
  ),
];

export const validatePatchPaths = (
  operations: JsonPatchOperationDto[],
): void => {
  for (const operation of operations) {
    if (!operation.path || operation.path[0] !== '/') {
      throw new BadRequestException(`Invalid patch path: ${operation.path}`);
    }

    const isAllowed = allowedPathPatterns.some((pattern) =>
      pattern.test(operation.path),
    );

    if (!isAllowed) {
      throw new BadRequestException(
        `Patch path is not allowed: ${operation.path}`,
      );
    }

    if (operation.from) {
      const fromAllowed = allowedPathPatterns.some((pattern) =>
        pattern.test(operation.from as string),
      );
      if (!fromAllowed) {
        throw new BadRequestException(
          `Patch from path is not allowed: ${operation.from}`,
        );
      }
    }
  }
};

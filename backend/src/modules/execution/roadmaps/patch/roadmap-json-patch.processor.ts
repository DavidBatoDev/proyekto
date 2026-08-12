import { BadRequestException, Injectable } from '@nestjs/common';
import { applyPatch } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import type {
  FullRoadmapState,
  JsonPatchOperationDto,
} from '../dto/patch-roadmap.dto';
import { validatePatchPaths } from './roadmap-patch-path.validator';

@Injectable()
export class RoadmapJsonPatchProcessor {
  apply(
    currentState: FullRoadmapState,
    operations: JsonPatchOperationDto[],
  ): FullRoadmapState {
    validatePatchPaths(operations);

    let patchedDocument: FullRoadmapState;

    try {
      patchedDocument = applyPatch(
        structuredClone(currentState),
        operations as Operation[],
        true,
        false,
      ).newDocument;
    } catch (error) {
      throw new BadRequestException(
        `Invalid JSON patch payload: ${(error as Error).message}`,
      );
    }

    this.assertPatchedRoadmapShape(patchedDocument);

    return patchedDocument;
  }

  private assertPatchedRoadmapShape(document: FullRoadmapState) {
    if (!document || typeof document !== 'object') {
      throw new BadRequestException('Patched roadmap must be an object');
    }

    if (!document.name || typeof document.name !== 'string') {
      throw new BadRequestException('Patched roadmap must include name');
    }

    if (
      document.roadmap_epics !== undefined &&
      !Array.isArray(document.roadmap_epics)
    ) {
      throw new BadRequestException('roadmap_epics must be an array');
    }

    for (const epic of document.roadmap_epics ?? []) {
      if (!epic.title || typeof epic.title !== 'string') {
        throw new BadRequestException('Every epic must include title');
      }
      if (
        epic.roadmap_features !== undefined &&
        !Array.isArray(epic.roadmap_features)
      ) {
        throw new BadRequestException('roadmap_features must be an array');
      }

      for (const feature of epic.roadmap_features ?? []) {
        if (!feature.title || typeof feature.title !== 'string') {
          throw new BadRequestException('Every feature must include title');
        }
        if (
          feature.roadmap_tasks !== undefined &&
          !Array.isArray(feature.roadmap_tasks)
        ) {
          throw new BadRequestException('roadmap_tasks must be an array');
        }

        for (const task of feature.roadmap_tasks ?? []) {
          if (!task.title || typeof task.title !== 'string') {
            throw new BadRequestException('Every task must include title');
          }
        }
      }
    }
  }
}

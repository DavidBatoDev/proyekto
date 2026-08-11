import { ForbiddenException } from '@nestjs/common';
import type { PermissionPath } from '../permissions/project-permissions';

/**
 * Structured 403 thrown by the authorization layer. The frontend looks at
 * `code: 'missing_permission'` and renders a human-readable toast/banner
 * naming the missing capability — see web/src/lib/permissionErrors.ts.
 *
 * `path` is the fine-grained permission path (e.g. 'roadmap.edit'). When
 * the failure is a coarse role check rather than a fine-grained one, set
 * `path: null` and let `requiredRole` (e.g. 'admin') carry the gist.
 */
export class MissingPermissionException extends ForbiddenException {
  constructor(params: {
    /** Fine-grained permission path that was missing. */
    path: PermissionPath | null;
    /** Optional minimum role string when the gate was role-based. */
    requiredRole?: string | null;
    /** Human-readable label shown in toasts when the FE catalog is unavailable. */
    label?: string;
    /** Override the default error message; otherwise generated from label/path. */
    message?: string;
  }) {
    const message =
      params.message ??
      (params.label
        ? `You don't have permission to ${params.label}.`
        : params.path
          ? `Missing required permission '${params.path}' on this project.`
          : params.requiredRole
            ? `Insufficient role on this project — need '${params.requiredRole}' or stronger.`
            : 'You do not have permission to perform this action.');

    super({
      code: 'missing_permission',
      message,
      path: params.path,
      label: params.label ?? null,
      requiredRole: params.requiredRole ?? null,
    });
  }
}

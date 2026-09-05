import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { NotificationsService } from '../../../shared/notifications/notifications.service';

/** The slice of a task row the assignment notification needs. */
export type TaskAssigneeNotificationTask = {
  id?: string | null;
  title?: string | null;
  feature_id?: string | null;
};

/**
 * One home for the "you were assigned to a task" fan-out, shared by the direct
 * task write path (TasksService.create / update) and the AI commit path
 * (RoadmapAiService.commit). Callers pass ONLY the ids their write newly
 * assigned — never the whole current set — and the actor is never notified
 * about assigning themself.
 *
 * Deliveries are awaited sequentially (no detached promise: a `void`ed fan-out
 * can be frozen mid-flight when a Cloud Run instance is scaled to zero after
 * the response is sent). A delivery failure propagates so each caller chooses
 * its policy: the direct write path surfaces it, the AI commit swallows it
 * because the roadmap is already updated by then.
 */
@Injectable()
export class TaskAssigneeNotifierService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * @param input.projectId Pass it (even `null`) when the caller already knows
   *   the roadmap's project so the feature -> epic -> roadmap lookup is skipped;
   *   leave it `undefined` to resolve it from `task.feature_id`.
   */
  async notifyNewlyAssigned(input: {
    task: TaskAssigneeNotificationTask;
    assigneeIds: string[];
    actorId: string;
    projectId?: string | null;
  }): Promise<void> {
    const { task, actorId } = input;
    // Uuids are case-insensitive: lowercase BEFORE deduping so a mixed-case
    // duplicate yields one notification, and the actor is excluded whatever
    // casing the caller used for either side.
    const actorKey = actorId.toLowerCase();
    const recipients = [
      ...new Set(
        input.assigneeIds
          .filter((assigneeId) => typeof assigneeId === 'string' && assigneeId)
          .map((assigneeId) => assigneeId.toLowerCase()),
      ),
    ].filter((assigneeId) => assigneeId !== actorKey);
    if (!recipients.length) return;

    const title =
      typeof task?.title === 'string' && task.title.trim().length > 0
        ? task.title.trim()
        : 'Untitled task';

    const projectId =
      input.projectId !== undefined
        ? input.projectId
        : await this.resolveProjectId(task?.feature_id ?? null);

    for (const assigneeId of recipients) {
      await this.notifications.createNotification({
        user_id: assigneeId,
        project_id: projectId ?? undefined,
        type_name: 'task_assigned',
        actor_id: actorId,
        content: {
          task_id: task?.id ?? null,
          task_title: title,
          message: `You were assigned to "${title}".`,
        },
        link_url:
          projectId && task?.id
            ? `/project/${projectId}/roadmap?taskId=${task.id}`
            : undefined,
      });
    }
  }

  private async resolveProjectId(
    featureId: string | null,
  ): Promise<string | null> {
    if (!featureId) return null;
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(
        'epic:roadmap_epics!roadmap_features_epic_id_fkey(roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id))',
      )
      .eq('id', featureId)
      .maybeSingle();
    if (error) return null;
    const row = (data ?? null) as {
      epic: {
        roadmap: { project_id: string | null } | null;
      } | null;
    } | null;
    return row?.epic?.roadmap?.project_id ?? null;
  }
}

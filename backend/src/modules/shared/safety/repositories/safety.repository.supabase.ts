import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { findBlockerIds } from '../blocks.queries';
import type { CommentTargetType, ReportTargetType } from '../safety.tokens';
import type {
  BlockedUser,
  NewContentReport,
  ProfileSummary,
  ReportedComment,
  SafetyRepository,
} from './safety.repository.interface';

/** Tasks name the author `author_id`; epics and features call it `user_id`. */
const COMMENT_TABLE: Record<
  CommentTargetType,
  { table: string; author: string; parent: string }
> = {
  task_comment: {
    table: 'task_comments',
    author: 'author_id',
    parent: 'task_id',
  },
  epic_comment: {
    table: 'epic_comments',
    author: 'user_id',
    parent: 'epic_id',
  },
  feature_comment: {
    table: 'feature_comments',
    author: 'user_id',
    parent: 'feature_id',
  },
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

const PROFILE_COLUMNS =
  'id, display_name, first_name, last_name, email, avatar_url';

function profileName(row: ProfileRow | null | undefined): string | null {
  if (!row) return null;
  const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return row.display_name?.trim() || full || row.email || null;
}

@Injectable()
export class SupabaseSafetyRepository implements SafetyRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('user_blocks')
      .select('blocker_id')
      .in('blocker_id', [a, b])
      .in('blocked_id', [a, b])
      .limit(1);
    if (error) throw new Error(error.message);
    // blocker <> blocked is a table CHECK, so any row here is a↔b.
    return (data ?? []).length > 0;
  }

  async listBlocks(blockerId: string): Promise<BlockedUser[]> {
    const { data, error } = await this.db
      .from('user_blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', blockerId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const { data: profiles, error: profileError } = await this.db
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .in(
        'id',
        rows.map((row) => String(row.blocked_id)),
      );
    if (profileError) throw new Error(profileError.message);
    const byId = new Map(
      ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p]),
    );

    return rows.map((row) => {
      const profile = byId.get(String(row.blocked_id));
      return {
        user_id: String(row.blocked_id),
        blocked_at: String(row.created_at),
        display_name: profileName(profile),
        avatar_url: profile?.avatar_url ?? null,
      };
    });
  }

  async addBlock(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.db
      .from('user_blocks')
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  }

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await this.db
      .from('user_blocks')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId);
    if (error) throw new Error(error.message);
  }

  blockersAmong(blockedId: string, candidateIds: string[]) {
    return findBlockerIds(this.db, blockedId, candidateIds);
  }

  async findComment(
    targetType: CommentTargetType,
    commentId: string,
  ): Promise<ReportedComment | null> {
    const spec = COMMENT_TABLE[targetType];
    const { data, error } = await this.db
      .from(spec.table)
      .select(`id, content, ${spec.author}, ${spec.parent}`)
      .eq('id', commentId)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as unknown as Record<string, string | null>;
    const parentId = row[spec.parent] ?? undefined;
    return {
      id: String(row.id),
      authorId: row[spec.author] ?? null,
      content: row.content ?? '',
      ...(targetType === 'task_comment' ? { taskId: parentId } : {}),
      ...(targetType === 'epic_comment' ? { epicId: parentId } : {}),
      ...(targetType === 'feature_comment' ? { featureId: parentId } : {}),
    };
  }

  async findProfile(userId: string): Promise<ProfileSummary | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as ProfileRow;
    return {
      id: row.id,
      name: profileName(row) ?? 'Unknown',
      email: row.email,
    };
  }

  async findReportId(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from('content_reports')
      .select('id')
      .eq('reporter_id', reporterId)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .maybeSingle();
    if (error || !data) return null;
    return String(data.id);
  }

  async insertReport(report: NewContentReport): Promise<string | null> {
    const { data, error } = await this.db
      .from('content_reports')
      .insert({
        reporter_id: report.reporterId,
        reported_user_id: report.reportedUserId,
        target_type: report.targetType,
        target_id: report.targetId,
        room_id: report.roomId,
        project_id: report.projectId,
        reason: report.reason,
        details: report.details,
        content_snapshot: report.contentSnapshot,
      })
      .select('id')
      .single();
    if (error) {
      // 23505: the (reporter, target) unique index. A second tap is not an error.
      if (error.code === '23505') return null;
      throw new Error(error.message);
    }
    return String(data.id);
  }
}

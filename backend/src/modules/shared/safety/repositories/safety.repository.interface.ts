import type {
  CommentTargetType,
  ReportReason,
  ReportTargetType,
} from '../safety.tokens';

export interface BlockedUser {
  user_id: string;
  blocked_at: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ReportedComment {
  id: string;
  authorId: string | null;
  content: string;
  /** Exactly one is set, matching the comment's table. */
  taskId?: string;
  epicId?: string;
  featureId?: string;
}

export interface NewContentReport {
  reporterId: string;
  reportedUserId: string | null;
  targetType: ReportTargetType;
  targetId: string;
  roomId: string | null;
  projectId: string | null;
  reason: ReportReason;
  details: string | null;
  contentSnapshot: string | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  email: string | null;
}

export interface SafetyRepository {
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
  listBlocks(blockerId: string): Promise<BlockedUser[]>;
  addBlock(blockerId: string, blockedId: string): Promise<void>;
  removeBlock(blockerId: string, blockedId: string): Promise<void>;
  blockersAmong(
    blockedId: string,
    candidateIds: string[],
  ): Promise<Set<string>>;

  findComment(
    targetType: CommentTargetType,
    commentId: string,
  ): Promise<ReportedComment | null>;
  findProfile(userId: string): Promise<ProfileSummary | null>;
  findReportId(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<string | null>;
  /** Returns the new id, or null when the unique index says it already exists. */
  insertReport(report: NewContentReport): Promise<string | null>;
}

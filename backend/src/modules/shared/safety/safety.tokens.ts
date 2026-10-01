export const SAFETY_REPOSITORY = Symbol('SAFETY_REPOSITORY');

export const REPORT_TARGET_TYPES = [
  'chat_message',
  'task_comment',
  'epic_comment',
  'feature_comment',
  'user',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type CommentTargetType = Exclude<
  ReportTargetType,
  'chat_message' | 'user'
>;

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'violence',
  'self_harm',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  violence: 'Violence or threats',
  self_harm: 'Self-harm',
  other: 'Something else',
};

export const REPORT_TARGET_LABEL: Record<ReportTargetType, string> = {
  chat_message: 'chat message',
  task_comment: 'task comment',
  epic_comment: 'epic comment',
  feature_comment: 'feature comment',
  user: 'person',
};

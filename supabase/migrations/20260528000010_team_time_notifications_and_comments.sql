-- Team-time review collaboration + notification event expansion
-- Date: 2026-05-28

CREATE TABLE IF NOT EXISTS public.time_log_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.task_time_logs(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_log_comments_log_created
  ON public.time_log_comments(log_id, created_at ASC);

DROP TRIGGER IF EXISTS trg_time_log_comments_updated_at ON public.time_log_comments;
CREATE TRIGGER trg_time_log_comments_updated_at
BEFORE UPDATE ON public.time_log_comments
FOR EACH ROW
EXECUTE FUNCTION public.handle_notifications_updated_at();

ALTER TABLE public.time_log_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read allowed time log comments"
ON public.time_log_comments;
CREATE POLICY "Users can read allowed time log comments"
ON public.time_log_comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.task_time_logs l
    LEFT JOIN public.teams t
      ON t.id = l.team_id
    LEFT JOIN public.team_members tm
      ON tm.team_id = l.team_id
     AND tm.user_id = auth.uid()
    WHERE l.id = time_log_comments.log_id
      AND (
        l.member_user_id = auth.uid()
        OR t.owner_id = auth.uid()
        OR tm.role IN ('owner', 'admin')
      )
  )
);

DROP POLICY IF EXISTS "Users can add allowed time log comments"
ON public.time_log_comments;
CREATE POLICY "Users can add allowed time log comments"
ON public.time_log_comments
FOR INSERT
WITH CHECK (
  author_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.task_time_logs l
    LEFT JOIN public.teams t
      ON t.id = l.team_id
    LEFT JOIN public.team_members tm
      ON tm.team_id = l.team_id
     AND tm.user_id = auth.uid()
    WHERE l.id = time_log_comments.log_id
      AND (
        l.member_user_id = auth.uid()
        OR t.owner_id = auth.uid()
        OR tm.role IN ('owner', 'admin')
      )
  )
);

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('time_log_approval_requested', 'specific', 'medium'),
  ('time_log_approved', 'specific', 'medium'),
  ('time_log_rejected', 'specific', 'high'),
  ('time_log_pending', 'specific', 'low'),
  ('time_log_day_rejected', 'specific', 'high'),
  ('time_log_comment_added', 'specific', 'medium'),
  ('task_assigned', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;


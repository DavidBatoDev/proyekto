-- Keep the signup-time mention-invite notification out of the email outbox.
--
-- `email_eligible` carries two meanings now, and they conflict. For the mention
-- and DM types it means "auto-enqueue an email when this notification is
-- created", which is what this trigger reads. For `roadmap_mention_invite` it was
-- reused as the FEATURE switch, read by RoadmapMentionInviteService and by
-- getMyPermissions, so that one UPDATE turns the feature on for both server and
-- client.
--
-- Turning that switch on therefore also made this trigger enqueue mail for the
-- notification the reconciler creates AT SIGNUP — so someone would receive the
-- pre-signup invite email, sign up because of it, and then get a second email ten
-- minutes later about the mention they had just acted on. The 20260804160000
-- migration's own comment warned about exactly this.
--
-- The pre-signup email for this type is inserted into the outbox directly by the
-- backend, with the recipient's address and their own unsubscribe token. The
-- post-signup notification needs no email at all: they are already in the app,
-- looking at it.
--
-- Rebuilt from the newest body (20260804090000) with one added guard.
CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type public.notification_types%ROWTYPE;
BEGIN
  SELECT * INTO v_type
  FROM public.notification_types
  WHERE id = NEW.type_id;

  IF NOT FOUND OR NOT v_type.email_eligible THEN
    RETURN NEW;
  END IF;

  -- See the header. For this type email_eligible is a feature switch, not an
  -- instruction to enqueue; its mail is queued by the backend before the
  -- recipient has an account at all.
  IF v_type.name = 'roadmap_mention_invite' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_email_outbox
    (notification_id, user_id, type_name, send_after, payload)
  VALUES (
    NEW.id,
    NEW.user_id,
    v_type.name,
    now() + make_interval(secs => v_type.email_delay_seconds),
    jsonb_build_object(
      'content', COALESCE(NEW.content, '{}'::jsonb),
      'link_url', NEW.link_url,
      'project_id', NEW.project_id,
      'actor_id', NEW.actor_id
    )
  )
  ON CONFLICT (notification_id) WHERE notification_id IS NOT NULL DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification_email failed for notification %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

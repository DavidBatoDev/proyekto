-- Migration: 20260621100000_drop_chat_participants_project_id.sql
-- Date: June 21, 2026
-- Description:
--   Drop chat_room_participants.project_id. It was a denormalized copy of the
--   room's project used by the original self-join RLS and a (user_id, project_id)
--   index. Both are gone: global_dms made it nullable, dropped that index, and
--   rewrote the RLS to derive the project via room_id -> chat_rooms; the
--   flexible-channels self-join policy does the same. No remaining policy, index,
--   or query reads this column (the FK to projects only duplicated the
--   room_id -> chat_rooms -> projects ON DELETE CASCADE). Membership is keyed on
--   (room_id, user_id).

ALTER TABLE public.chat_room_participants
  DROP CONSTRAINT IF EXISTS chat_room_participants_project_id_fkey;

ALTER TABLE public.chat_room_participants
  DROP COLUMN IF EXISTS project_id;

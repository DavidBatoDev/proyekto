-- Add 'consultation' to meeting_type for public / guest profile-level bookings
-- (Calendly-style "book a call" from a consultant's public profile — Phase 3).
--
-- Kept in its own migration with no explicit transaction wrapper: a new enum value
-- must be committed before it can be referenced, so it cannot be added and used in
-- the same transaction. Adding it standalone here keeps the foundation migration
-- (…_revive_meetings_scheduling) fully transactional.
ALTER TYPE public.meeting_type ADD VALUE IF NOT EXISTS 'consultation';

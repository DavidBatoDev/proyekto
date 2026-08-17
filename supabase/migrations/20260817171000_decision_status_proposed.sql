-- Decisions gain a pre-final state.
--
-- The original CHECK allowed only final | superseded, which meant the log could
-- record what HAD been decided but never what was BEING decided. Arguments then
-- live in chat until they settle, and the thing the log exists to prevent —
-- "why did we choose this?" — is unanswerable for exactly the period when the
-- question is loudest.
--
-- `proposed` is a state, not an approval ladder: there is no approver, no
-- notification, and no reviewer table. Moving to final is a button for anyone
-- with decisions.edit. If a real approval workflow is ever wanted, it goes on
-- top of this rather than replacing it.
--
-- The default stays 'final'. Recording a settled decision is still the common
-- case, and flipping the default would change the meaning of every create call
-- that omits the field.

BEGIN;

ALTER TABLE public.project_decisions
  DROP CONSTRAINT IF EXISTS project_decisions_status_check;

ALTER TABLE public.project_decisions
  ADD CONSTRAINT project_decisions_status_check
    CHECK (status IN ('proposed', 'final', 'superseded'));

COMMENT ON COLUMN public.project_decisions.status IS
  'proposed = still being argued; final = settled; superseded = replaced by a newer decision.';

COMMIT;

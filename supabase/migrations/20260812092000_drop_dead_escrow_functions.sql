-- Phase 3 removes two escrow RPCs whose backing payment tables were dropped in
-- January 2026. Wallet storage and create_wallet_for_user remain because user
-- provisioning still depends on that trigger path.

DROP FUNCTION IF EXISTS public.fund_escrow(uuid, uuid);

DROP FUNCTION IF EXISTS public.refund_escrow(uuid);

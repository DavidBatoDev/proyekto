-- Minimum-supported native shell per platform, for the in-app update prompt.
--
-- This is about the NATIVE binary (the store build), not the OTA web bundle in
-- mobile_app_bundles. The two are related: raising a bundle's native_build_min
-- makes resolveUpdate() stop serving OTA updates to older shells, which strands
-- those devices on stale code with no signal. This table is the signal — set
-- min_supported_build to the same value and those users are told to update.
--
-- Thresholds, evaluated against the device's versionCode / CFBundleVersion:
--   build <  min_supported_build  -> 'required' (blocking prompt)
--   build <  latest_build         -> 'optional' (dismissible prompt)
--   otherwise                     -> 'ok'
--
-- Seed min_supported_build = 1 so nobody is blocked until it is deliberately
-- raised.

CREATE TABLE IF NOT EXISTS public.mobile_app_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform public.mobile_bundle_platform NOT NULL,
  channel text NOT NULL DEFAULT 'production',
  min_supported_build integer NOT NULL,  -- below this, the app blocks
  latest_build integer NOT NULL,         -- newest build shipped to the store
  latest_version text NOT NULL,          -- its marketing version, e.g. "1.0.0"
  store_url text NOT NULL,               -- deep link to the store listing
  message text,                          -- optional override copy for the prompt
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mobile_app_requirements_min_build_pos CHECK (min_supported_build >= 1),
  CONSTRAINT mobile_app_requirements_latest_build_pos CHECK (latest_build >= 1),
  -- A shell newer than the newest released build cannot be "too old".
  CONSTRAINT mobile_app_requirements_min_lte_latest
    CHECK (min_supported_build <= latest_build),
  CONSTRAINT mobile_app_requirements_platform_channel_uniq
    UNIQUE (platform, channel)
);

CREATE OR REPLACE FUNCTION public.handle_mobile_app_requirements_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mobile_app_requirements_updated_at ON public.mobile_app_requirements;
CREATE TRIGGER trg_mobile_app_requirements_updated_at
BEFORE UPDATE ON public.mobile_app_requirements
FOR EACH ROW
EXECUTE FUNCTION public.handle_mobile_app_requirements_updated_at();

ALTER TABLE public.mobile_app_requirements ENABLE ROW LEVEL SECURITY;

-- Same posture as mobile_app_bundles: the hot path reads through the backend's
-- service-role client, and we expose a public SELECT because the update check
-- has to work for a signed-out app. No write policy — only the service role
-- (or a human in the SQL editor) can change the thresholds.
DROP POLICY IF EXISTS "Public can read app requirements" ON public.mobile_app_requirements;
CREATE POLICY "Public can read app requirements"
  ON public.mobile_app_requirements
  FOR SELECT
  USING (true);

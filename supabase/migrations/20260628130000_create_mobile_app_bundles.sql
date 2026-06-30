-- Self-hosted OTA bundle registry for @capgo/capacitor-updater (auto-update).
--
-- Each row is a published web bundle (zipped Vite dist/) hosted on R2. The mobile
-- update-check endpoint serves the latest published, native-compatible bundle.
--
-- native_build_min is the safety field: a web bundle is only served to a native
-- shell whose build (versionCode/CFBundleVersion) is >= native_build_min, so a
-- bundle that needs a newer native shell is never pushed to an old one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mobile_bundle_platform') THEN
    CREATE TYPE public.mobile_bundle_platform AS ENUM ('android', 'ios');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mobile_bundle_status') THEN
    CREATE TYPE public.mobile_bundle_status AS ENUM ('published', 'rolled_back');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.mobile_app_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform public.mobile_bundle_platform NOT NULL,
  channel text NOT NULL DEFAULT 'production',
  version text NOT NULL,              -- OTA bundle version string, e.g. "1.42"
  native_build_min integer NOT NULL,  -- min native versionCode/build this web bundle needs
  r2_key text NOT NULL,               -- e.g. mobile-bundles/android/production/1.42.zip
  url text NOT NULL,                  -- public CDN download URL for the zip
  checksum text NOT NULL,             -- sha256 lowercase hex (64 chars)
  size_bytes bigint NOT NULL DEFAULT 0,
  status public.mobile_bundle_status NOT NULL DEFAULT 'published',
  changelog text,
  created_by text,                    -- e.g. "ci:<run_id>" or operator email
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_app_bundles_checksum_len CHECK (char_length(checksum) = 64),
  CONSTRAINT mobile_app_bundles_native_build_min_pos CHECK (native_build_min >= 1),
  CONSTRAINT mobile_app_bundles_version_channel_platform_uniq
    UNIQUE (platform, channel, version)
);

-- Hot-path query: latest published, native-compatible bundle for a platform/channel.
CREATE INDEX IF NOT EXISTS idx_mobile_bundles_lookup
  ON public.mobile_app_bundles (platform, channel, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_bundles_native_min
  ON public.mobile_app_bundles (native_build_min);

CREATE OR REPLACE FUNCTION public.handle_mobile_app_bundles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mobile_app_bundles_updated_at ON public.mobile_app_bundles;
CREATE TRIGGER trg_mobile_app_bundles_updated_at
BEFORE UPDATE ON public.mobile_app_bundles
FOR EACH ROW
EXECUTE FUNCTION public.handle_mobile_app_bundles_updated_at();

ALTER TABLE public.mobile_app_bundles ENABLE ROW LEVEL SECURITY;

-- Reads/writes on the hot path go through the backend service-role client
-- (SUPABASE_ADMIN), which bypasses RLS. We expose only a public SELECT of
-- published rows; there is intentionally no INSERT/UPDATE/DELETE policy, so
-- only the service role can write.
DROP POLICY IF EXISTS "Public can read published bundles" ON public.mobile_app_bundles;
CREATE POLICY "Public can read published bundles"
  ON public.mobile_app_bundles
  FOR SELECT
  USING (status = 'published');

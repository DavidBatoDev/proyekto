-- Per-page initials on a service agreement.
--
-- A signature block at the end proves the parties agreed to *a* document. Initials
-- on every page prove they saw each page of THIS one, which is what stops a page
-- being swapped after signing. Adobe Sign and DocuSign both work this way.
--
-- One row per (contract, seat, page). `image_url` is what gets stamped on the
-- page; `initials_text` is kept alongside it for a typed mark because the typed
-- characters are the evidence and the rendering is only how they were drawn —
-- the same split the signature columns on `contracts` already use.
--
-- Uploading an image is deliberately NOT a method here, matching SignaturePad's
-- documented rule: an uploaded file is the one input that cannot be attributed
-- to the person at the keyboard.

CREATE TABLE IF NOT EXISTS public.contract_page_initials (
  contract_id uuid NOT NULL
    REFERENCES public.contracts(id) ON DELETE CASCADE,
  -- Mirrors contract_positions.position: the seat, not the person, so a party
  -- swap on an unsigned contract cannot orphan the marks.
  "position" text NOT NULL,
  page_index integer NOT NULL,
  method text NOT NULL,
  /** The characters the signer typed. NULL for a drawn mark. */
  initials_text text,
  /** The rendering stamped on the page — a PNG for both methods. */
  image_url text NOT NULL,
  signed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_page_initials_pkey
    PRIMARY KEY (contract_id, "position", page_index),
  CONSTRAINT contract_page_initials_position_check
    CHECK ("position" IN ('hirer', 'provider')),
  CONSTRAINT contract_page_initials_page_check
    CHECK (page_index >= 0 AND page_index < 200),
  CONSTRAINT contract_page_initials_method_check
    CHECK (method IN ('typed', 'drawn')),
  CONSTRAINT contract_page_initials_typed_text_check
    CHECK (
      method <> 'typed'
      OR (initials_text IS NOT NULL AND length(btrim(initials_text)) BETWEEN 1 AND 8)
    ),
  CONSTRAINT contract_page_initials_image_check
    CHECK (length(btrim(image_url)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_contract_page_initials_contract
  ON public.contract_page_initials (contract_id);

COMMENT ON TABLE public.contract_page_initials IS
  'Per-page initials proving each page of a signed agreement was seen. One row per (contract, seat, page).';
COMMENT ON COLUMN public.contract_page_initials.initials_text IS
  'The characters typed by the signer; NULL for a drawn mark. The typed text is the evidence, image_url is its rendering.';

-- Service-role only, matching contract_positions: every read and write goes
-- through the backend, which also serves the account-free signing page, so there
-- is no authenticated path that should reach this table directly.
ALTER TABLE public.contract_page_initials ENABLE ROW LEVEL SECURITY;

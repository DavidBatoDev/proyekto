-- Remove projects.consultant_id as an authorization input from the finance
-- RLS policies. Existing project_access predicates and explicit owner/client
-- contract visibility remain unchanged.

BEGIN;

ALTER POLICY "Authorized users can view finance project settings"
ON public.finance_project_settings
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_project_settings.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can insert finance project settings"
ON public.finance_project_settings
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_project_settings.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can update finance project settings"
ON public.finance_project_settings
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_project_settings.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_project_settings.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can view finance member allocations"
ON public.finance_member_allocations
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_member_allocations.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can insert finance member allocations"
ON public.finance_member_allocations
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_member_allocations.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can update finance member allocations"
ON public.finance_member_allocations
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_member_allocations.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_member_allocations.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Authorized users can delete finance member allocations"
ON public.finance_member_allocations
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = finance_member_allocations.project_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Project owners can view signature links"
ON public.contract_signature_links
USING (
  EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.project_access pa ON pa.project_id = c.project_id
    WHERE c.id = contract_signature_links.contract_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Project owners can create signature links"
ON public.contract_signature_links
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.project_access pa ON pa.project_id = c.project_id
    WHERE c.id = contract_signature_links.contract_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Project owners can revoke signature links"
ON public.contract_signature_links
USING (
  EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.project_access pa ON pa.project_id = c.project_id
    WHERE c.id = contract_signature_links.contract_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Project owners can delete signature links"
ON public.contract_signature_links
USING (
  EXISTS (
    SELECT 1
    FROM public.contracts c
    JOIN public.project_access pa ON pa.project_id = c.project_id
    WHERE c.id = contract_signature_links.contract_id
      AND pa.user_id = auth.uid()
      AND pa.role IN ('owner', 'admin')
  )
);

ALTER POLICY "Project editors can insert contracts"
ON public.contracts
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND p.owner_id = auth.uid()
  )
);

ALTER POLICY "Project editors can update contracts"
ON public.contracts
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND p.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role, 'editor'::public.share_role])
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND p.owner_id = auth.uid()
  )
);

ALTER POLICY "Project members can view contracts"
ON public.contracts
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND p.owner_id = auth.uid()
  )
  OR contracts.client_user_id = auth.uid()
);

ALTER POLICY "Project admins can delete draft contracts"
ON public.contracts
USING (
  contracts.status = ANY (ARRAY['draft'::text, 'cancelled'::text])
  AND EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
      AND pa.role = ANY (ARRAY['owner'::public.share_role, 'admin'::public.share_role])
  )
);

COMMENT ON COLUMN public.project_access.origin IS
  'Primary source of project access. Authorization-relevant values include consultant for finance ownership, client/personal_workspace/legacy for client chat persona, and team:* for curated team grants.';

COMMIT;

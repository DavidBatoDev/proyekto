-- Project Invitation Links Feature
-- Migration: 20260417000000_project_invitation_links.sql
-- Description: Adds Google Docs-style role-typed invite links with consultant approval workflow

-- ============================================================================
-- CREATE project_invitation_links TABLE
-- ============================================================================

CREATE TABLE project_invitation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  role_type TEXT NOT NULL CHECK (role_type IN ('consultant', 'freelancer', 'client')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique token lookup index
CREATE UNIQUE INDEX idx_invitation_links_token
  ON project_invitation_links(token);

-- Only one active link per role per project
CREATE UNIQUE INDEX idx_invitation_links_active
  ON project_invitation_links(project_id, role_type)
  WHERE is_active = true;

CREATE INDEX idx_invitation_links_project_id
  ON project_invitation_links(project_id);

-- ============================================================================
-- CREATE project_invitation_requests TABLE
-- ============================================================================

CREATE TABLE project_invitation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_link_id UUID NOT NULL REFERENCES project_invitation_links(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requester_email TEXT,
  role_requested TEXT NOT NULL CHECK (role_requested IN ('consultant', 'freelancer', 'client')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitation_requests_project_id
  ON project_invitation_requests(project_id);

CREATE INDEX idx_invitation_requests_status
  ON project_invitation_requests(project_id, status);

CREATE INDEX idx_invitation_requests_requester_id
  ON project_invitation_requests(requester_id);

-- At most one pending request per requester per role per project
CREATE UNIQUE INDEX idx_invitation_requests_one_pending
  ON project_invitation_requests(project_id, requester_id, role_requested)
  WHERE status = 'pending';

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

CREATE TRIGGER update_invitation_links_updated_at
  BEFORE UPDATE ON project_invitation_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invitation_requests_updated_at
  BEFORE UPDATE ON project_invitation_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES: project_invitation_links
-- ============================================================================

ALTER TABLE project_invitation_links ENABLE ROW LEVEL SECURITY;

-- SELECT: Project consultant can view all links for their project; anyone can look up by token via service role
CREATE POLICY invitation_links_select ON project_invitation_links
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- INSERT: Only the project consultant can create links
CREATE POLICY invitation_links_insert ON project_invitation_links
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- UPDATE: Only the project consultant can update (revoke, etc.)
CREATE POLICY invitation_links_update ON project_invitation_links
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- DELETE: Only the project consultant can delete
CREATE POLICY invitation_links_delete ON project_invitation_links
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES: project_invitation_requests
-- ============================================================================

ALTER TABLE project_invitation_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: Consultant of the project sees all requests; requester sees their own
CREATE POLICY invitation_requests_select ON project_invitation_requests
  FOR SELECT USING (
    requester_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- INSERT: Any authenticated user can submit a request (token validation done in service via service role)
CREATE POLICY invitation_requests_insert ON project_invitation_requests
  FOR INSERT WITH CHECK (
    requester_id = auth.uid()
  );

-- UPDATE: Only the project consultant can review (approve/reject)
CREATE POLICY invitation_requests_update ON project_invitation_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE id = project_id AND consultant_id = auth.uid()
    )
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE project_invitation_links IS 'Shareable role-typed invite links for projects; only the project consultant can generate them';
COMMENT ON TABLE project_invitation_requests IS 'Access requests submitted via invitation links; consultant reviews and approves/rejects';
COMMENT ON COLUMN project_invitation_links.role_type IS 'consultant = co-consultant member, freelancer = team member, client = ownership transfer';
COMMENT ON COLUMN project_invitation_requests.note IS 'Optional message from the requester explaining why they want access';

-- Finance books: the created, book-based finance surface in Engagements.
--
-- F1 personal (one per user), F2 team (one per team, owner-created), F3
-- project (children of an F2, only for projects with a signed client
-- contract). Books carry their own membership ACL (finance_book_members) so
-- external actors (HR, accountant, client) never appear in project_access and
-- never leak into execution surfaces. F2 -> F3 inheritance is resolved at
-- read time by the backend access service, never materialized here.
--
-- Like the engagement tables, these are backend-dark under RLS: service-role
-- only, no anon/authenticated policies. The TypeScript access service is the
-- security boundary (all finance services run on the service-role client).

BEGIN;

CREATE TABLE public.finance_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  owner_kind text NOT NULL,
  owner_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  parent_book_id uuid REFERENCES public.finance_books(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_books_kind_check
    CHECK (kind IN ('personal', 'team', 'project')),
  CONSTRAINT finance_books_owner_kind_check
    CHECK (owner_kind IN ('user', 'team')),
  CONSTRAINT finance_books_status_check
    CHECK (status IN ('active', 'archived')),
  -- Shape per kind: personal = user-owned, no parent/project; team =
  -- team-owned root; project = team-owned child with a project and parent.
  CONSTRAINT finance_books_shape_check
    CHECK (
      (kind = 'personal' AND owner_kind = 'user'
        AND owner_user_id IS NOT NULL AND owner_team_id IS NULL
        AND parent_book_id IS NULL AND project_id IS NULL)
      OR (kind = 'team' AND owner_kind = 'team'
        AND owner_team_id IS NOT NULL AND owner_user_id IS NULL
        AND parent_book_id IS NULL AND project_id IS NULL)
      OR (kind = 'project' AND owner_kind = 'team'
        AND owner_team_id IS NOT NULL AND owner_user_id IS NULL
        AND parent_book_id IS NOT NULL AND project_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_finance_books_personal_per_user
  ON public.finance_books(owner_user_id) WHERE kind = 'personal';
CREATE UNIQUE INDEX uq_finance_books_team_per_team
  ON public.finance_books(owner_team_id) WHERE kind = 'team';
CREATE UNIQUE INDEX uq_finance_books_project
  ON public.finance_books(project_id) WHERE kind = 'project';
CREATE INDEX idx_finance_books_parent
  ON public.finance_books(parent_book_id) WHERE parent_book_id IS NOT NULL;

COMMENT ON TABLE public.finance_books IS
  'Created finance surfaces in Engagements: personal (F1), team (F2), and per-project (F3, child of a team book). Never an execution authorization grant; membership lives in finance_book_members.';
COMMENT ON COLUMN public.finance_books.status IS
  'archived = read + export only, set when the backing client contract ends or is cancelled. Financial history is never deleted.';

CREATE TABLE public.finance_book_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.finance_books(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_email text,
  finance_role text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  inherited_from_book_id uuid REFERENCES public.finance_books(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_book_members_role_check
    CHECK (finance_role IN ('owner', 'manager', 'accountant', 'viewer_client', 'viewer')),
  CONSTRAINT finance_book_members_identity_check
    CHECK (user_id IS NOT NULL OR invited_email IS NOT NULL)
);

CREATE UNIQUE INDEX uq_finance_book_members_user
  ON public.finance_book_members(book_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_finance_book_members_email
  ON public.finance_book_members(book_id, lower(invited_email))
  WHERE invited_email IS NOT NULL AND user_id IS NULL;
CREATE INDEX idx_finance_book_members_user
  ON public.finance_book_members(user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.finance_book_members IS
  'Finance-only ACL, deliberately parallel to project_access: an external accountant or client here never gains execution access. Roles map to capability sets in finance-book-permissions.ts; capabilities jsonb carries per-member overrides (e.g. {"view_costs": false}).';
COMMENT ON COLUMN public.finance_book_members.inherited_from_book_id IS
  'Reserved for pinned overrides of an inherited grant. Plain F2 -> F3 inheritance is resolved at read time and writes no rows.';

CREATE TABLE public.finance_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.finance_books(id) ON DELETE CASCADE,
  email text NOT NULL,
  finance_role text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_invites_role_check
    CHECK (finance_role IN ('manager', 'accountant', 'viewer_client', 'viewer')),
  CONSTRAINT finance_invites_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired'))
);

CREATE INDEX idx_finance_invites_book ON public.finance_invites(book_id);
CREATE INDEX idx_finance_invites_email ON public.finance_invites(lower(email));

COMMENT ON TABLE public.finance_invites IS
  'Email invites into a finance book, mirroring project_team_invites: pre-signup targets are held here and converted to finance_book_members on accept. Owner is never invitable — ownership is implicit from the book.';

ALTER TABLE public.finance_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_book_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_invites ENABLE ROW LEVEL SECURITY;

COMMIT;

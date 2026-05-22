-- Add client_name and currency fields to projects table.
-- client_name stores the name of the client org/person for consultant-created projects.
-- currency stores the ISO 4217 code for the budget, defaulting to USD for backwards compat.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

# infra/ - Terraform

- .tfstate files here are COMMITTED on purpose. Never edit them (a hook blocks it) and never run `terraform apply` / `terraform destroy` from a session (permissions deny it).
- Prefer reading the .tf files to answer infra questions; `terraform plan` needs credentials the session does not have.
- Environment refs in infra/README.md are stale (old Mumbai/Sydney projects) - the live Supabase project is Singapore, ref byvbnkpiselvvulsvxgo; see docs/02-architecture/deploy-topology.md for current topology.

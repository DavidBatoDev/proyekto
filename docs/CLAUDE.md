# docs/ - Authoritative documentation tree

- docs/STYLE.md is law: verify every claim against source before writing it, ASCII diagrams only, every page carries "Last updated" + "Status" headers - update them on every touched page.
- Diagram exception: docs/13-proposals/ uses Mermaid instead of ASCII (state machines, ERDs, multi-actor sequences); its hub README states the exception. Everywhere else stays ASCII.
- Each numbered section (00-14) has a README.md hub - update it when adding, renaming, or moving pages.
- Sections 00-12 describe SHIPPED behaviour. Section 13-proposals holds general unbuilt designs. Section 14-engagement covers P4b: its schema and activation path shipped 2026-08-18, but the consuming runtime (assignments, time submission, approvals, redacted projections) is still unbuilt, so pages there must keep distinguishing live behavior from intended behavior. Draft pages in either section must clearly distinguish live schema from inactive behavior. When a proposal ships, rewrite it as current-state docs under its owning section and remove the obsolete draft.
- Never trust an existing count - recount from source (docs once said 24 backend modules and 165 migrations; actuals were 26 and 192).
- When documenting Supabase environment parity, say `public` schema parity, not full database cloning. Data, Auth, Storage, migration history, credentials, and project settings remain separate unless a distinct workflow explicitly changes them.
- Root SETUP.md was deleted; the canonical setup guide is docs/00-getting-started/setup.md - fix any dangling references you find.
- For a systematic drift pass, use /docs-update (delegates to the technical-writer agent).

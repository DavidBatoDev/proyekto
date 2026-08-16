# docs/ - Authoritative documentation tree

- docs/STYLE.md is law: verify every claim against source before writing it, ASCII diagrams only, every page carries "Last updated" + "Status" headers - update them on every touched page.
- Diagram exception: docs/11-domains/clients/ and docs/13-proposals/ use Mermaid instead of ASCII (state machines, ERDs, multi-actor sequences). Each of those two hub READMEs states the exception. Everywhere else stays ASCII.
- Each numbered section (00-14) has a README.md hub - update it when adding, renaming, or moving pages.
- Sections 00-12 describe SHIPPED behaviour. Section 13-proposals holds general unbuilt designs. Section 14-engagement is the dedicated exception for P4b's applied schema and not-yet-built runtime. Draft pages in either section must clearly distinguish live schema from inactive behavior. When a proposal ships, rewrite it as current-state docs under its owning section and remove the obsolete draft.
- Never trust an existing count - recount from source (docs once said 24 backend modules and 165 migrations; actuals were 26 and 192).
- Root SETUP.md was deleted; the canonical setup guide is docs/00-getting-started/setup.md - fix any dangling references you find.
- For a systematic drift pass, use /docs-update (delegates to the technical-writer agent).

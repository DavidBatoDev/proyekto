# docs/ - Authoritative documentation tree

- docs/STYLE.md is law: verify every claim against source before writing it, ASCII diagrams only, every page carries "Last updated" + "Status" headers - update them on every touched page.
- Each numbered section (00-12) has a README.md hub - update it when adding, renaming, or moving pages.
- Never trust an existing count - recount from source (docs once said 24 backend modules and 165 migrations; actuals were 26 and 192).
- Root SETUP.md was deleted; the canonical setup guide is docs/00-getting-started/setup.md - fix any dangling references you find.
- For a systematic drift pass, use /docs-update (delegates to the technical-writer agent).

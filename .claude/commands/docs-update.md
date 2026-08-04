---
description: Audit and update docs/ for drift against source
argument-hint: "[section, e.g. 03-backend, or 'all']"
---

Update docs for: $ARGUMENTS

1. Delegate to the **technical-writer** subagent, scoped to the given section (default when empty: the standing drift hot-list - module/migration counts, deleted-SETUP.md references, ReAct claims, residual Vercel claims - Vercel was fully removed 2026-08-04, web is the Cloudflare Worker proyekto-web; the only legitimate mention left is the orphaned backend/src/lambda.ts adapter - stale infra refs, retired-escrow descriptions).
2. It must follow docs/STYLE.md: verify every count/claim against source, update "Last updated" + "Status" on touched pages, reconcile section hub READMEs and docs/README.md, ASCII diagrams only.
3. Present the changed-file list with one-line summaries, plus drift found but not fixed (and why). Nothing is committed - changes land in the working tree for the user to review.

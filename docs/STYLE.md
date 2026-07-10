# Documentation Style Guide

> **Last updated:** 2026-07-09 · **Status:** current

How to write and organize pages in this knowledge base so everything reads as one
system. The reference exemplar is the [Meetings docs](./11-domains/meetings/README.md)
— when in doubt, mirror them.

## Structure

- Docs live in **numbered top-level section folders**: `00-getting-started/`,
  `01-product/`, … `12-runbooks/`. Numbers are on **folders only**.
- Topic files inside a section are **lowercase-kebab** (`system-overview.md`,
  `backend-api.md`) with **no numeric prefix** — they're rename-stable, and their
  reading order is carried by the section `README.md` index table.
- Every section folder has a `README.md` hub. Every folder is reachable from the
  [master index](./README.md).

## Every page

1. `# Title` — Title Case, short (`Architecture`, `Data Model`, `Backend API`).
2. A **metadata header** blockquote immediately under the title:
   ```
   > **Last updated:** YYYY-MM-DD · **Status:** current | draft | stub
   ```
   Bump the date whenever you meaningfully change the page. `stub` = scaffolded,
   not yet written; `draft` = in progress; `current` = trustworthy.
3. An opinionated one-paragraph **intro** (the "story" — what this is and why it
   matters), then `##` reference sections.

## House style

- **Tables** for anything enumerable — endpoints, columns, modules, env vars,
  secrets, troubleshooting (`| symptom | cause / fix |`). Two or three columns.
- **ASCII diagrams** (not Mermaid or images) for architecture, ERDs, and flows —
  box-drawing characters and arrows fenced in a plain code block.
- **Fenced code with a language tag** (`ts`, `tsx`, `sql`, `bash`) — illustrative
  **excerpts**, never full-file dumps.
- **Blockquote callouts** for the one-liner summary and warnings:
  `> **⚠️ …**`.
- **Present tense, terse, opinionated.** Story-driven intro, reference-driven body.
- A **glossary** table in the section README when the domain has its own vocabulary.

## Links

There is no docs-site build, so all links are **relative filesystem paths**. Write a
normal markdown link — a bracketed label followed by the target in parentheses — where
the target is:

- **Sibling doc** — a same-folder path `./file.md`, optionally deep-linked to a
  heading `./file.md#anchor`.
- **Source code** — repo-relative from the doc's location. From a section folder,
  `../../` reaches the repo root (e.g. `../../backend/src/...`); a page one level
  deeper (like `11-domains/meetings/`) needs `../../../`.
- Each section README's index table links to every page in the section.

## Accuracy & encoding

- **Verify against source, don't copy old docs.** Module lists, endpoints, table
  names, env vars, and deploy targets are written by reading the actual code
  (`backend/src/modules/`, `supabase/migrations/`, `.github/workflows/`,
  `wrangler.toml`), never carried over from a prior doc that may be stale.
- Save every file as **clean UTF-8**. No mojibake (`â€"`, `Â·`, `â”Œ`).
- Known truths to keep straight: the backend runs on **Cloud Run**
  (`api.proyekto.tech`), not Vercel; the DB is Supabase **Singapore**; files are on
  **Cloudflare R2**, not Supabase Storage; identity tables are `user_*`, not
  `consultant_*`.

## When adding or removing a page

- Add it to the section `README.md` index table (and, if a whole section changes
  status, update the [master index](./README.md)).
- Deleting a stale doc is fine — git history is the archive. Grep the tree for
  inbound links first so none dangle.

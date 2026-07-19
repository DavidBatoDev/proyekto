---
description: Cross-service review of the current working diff using the Proyekto checklist
argument-hint: "[optional focus: paths or an area, e.g. backend auth]"
---

Review the current working diff with Proyekto's cross-service checklist. (For a GitHub PR use the built-in /review; for a generic diff pass the built-in /code-review - THIS command is the project-specific pass.)

1. Collect the diff: `git status`, `git diff`, and `git diff --staged`. If a focus was given ($ARGUMENTS), scope to it but still note out-of-scope blast radius.
2. Delegate to the **code-reviewer** subagent (Agent tool), passing the changed file list, the diff, and the focus. It applies the checklist: contract sync (schemas/), guard/DTO/envelope/repository conventions, migration + RLS rules, optimistic UI + theme tokens + validPaths, env-var registration, test coverage.
3. Present its findings ordered by severity with file:line references, and the ship / ship-after-fixes / needs-rework verdict.
4. Offer to fix criticals; do not auto-fix anything without being asked.

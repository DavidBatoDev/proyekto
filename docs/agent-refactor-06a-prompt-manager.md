# #6a Phase A — PromptManager + versioned templates

Tracking doc for the prompt consolidation refactor. A follow-up PR will extract inline f-string prompts from planner modules; this PR sets up the infrastructure and migrates the five existing template files.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Goal (Phase A only)

Give prompts a single owner — `PromptManager` — with versioned template storage, an A/B selection hook, and a compatible shim for the existing `PromptRepository` callers. Zero user-visible behavior change: the same prompt text renders.

## Why this is the right first bite

- The existing `PromptRepository` is clean (~54 lines) but templates live at flat paths (`prompts/chat_mode.md`). Any A/B on "edit_mode v2" today means renaming files and editing every caller.
- The five existing templates are the easy migration. Their call sites are concentrated: `PromptRepository.build_system_prompt(mode, context)` is the one entry point used by `LLMPlanner` + a couple of others.
- Inline f-strings in `planner_operation_flow.py` / `planner_react_helpers.py` / `context_answer_service.py` are ~40+ sites that need per-site review (what context vars flow in, what prose is static, what should become a template). Those are **NOT in this pass**.
- #6b (OpenAI SDK migration + `cache_control` breakpoints) needs a stable prompt-building API but does **not** require inline-string extraction. So 6a Phase A unblocks 6b.

## Scope

**In scope:**
- New: `agent/app/core/prompts/manager.py` with `PromptManager`, `choose_version`, `render(template_id, version=None, context=None)` API
- New: `agent/app/core/prompts/templates/<id>/<version>.md` directory structure
- Migrate 5 existing templates — `base_system`, `chat_mode`, `edit_mode`, `query_mode`, `plan_mode`, `intent_classifier` — into the new structure as version `v1`
- `PromptRepository` becomes a thin backcompat shim that delegates to `PromptManager` — all existing callers continue working unchanged
- Version selection hook: `choose_version(template_id, session_id=None) -> str` with env override `AGENT_PROMPT_VERSION_OVERRIDE` (maps `template_id=version` entries)
- 3–5 unit tests: render default version, render explicit version, env override, missing template error shape, backcompat `PromptRepository` still works

**Not in scope (deferred):**
- Extracting inline f-string prompts in `planner_operation_flow.py` / `planner_react_helpers.py` / `context_answer_service.py`
- Adding `cache_control` markers (6b)
- LLM-response A/B logic (hook exists; real A/B comes later)
- Deleting `PromptRepository` — kept as shim until callers migrate naturally

## Design

### Directory layout

```
agent/app/core/prompts/
  manager.py              # PromptManager (new)
  repository.py           # backcompat shim → delegates to PromptManager
  templates/
    base_system/
      v1.md
    chat_mode/
      v1.md
    edit_mode/
      v1.md
    plan_mode/
      v1.md
    query_mode/
      v1.md
    intent_classifier/
      v1.md
```

The flat `prompts/*.md` files get moved (via `git mv` style) into `templates/<id>/v1.md` — content identical.

### PromptManager API

```python
class PromptManager:
    def __init__(self, templates_dir: Path | None = None) -> None: ...

    def render(
        self,
        template_id: str,
        *,
        version: str | None = None,
        session_id: str | None = None,
    ) -> str:
        """Load and return template text. If `version` is None, uses
        choose_version(template_id, session_id). Raises PromptNotFoundError
        on unknown template or version."""

    def build_system_prompt(
        self,
        mode: str,
        context: dict[str, Any],
        *,
        session_id: str | None = None,
    ) -> str:
        """Backcompat convenience. Composes base_system + mode_template +
        runtime context JSON — same shape as PromptRepository today."""


def choose_version(template_id: str, session_id: str | None = None) -> str:
    """Decide which version to render. Order of precedence:
      1. Env var AGENT_PROMPT_VERSION_OVERRIDE='chat_mode=v2,edit_mode=v3'
      2. Future: A/B logic keyed on session_id (stub returns 'v1' for now)
      3. Default: 'v1'
    """
```

### Backcompat shim

`PromptRepository` keeps its public methods (`load`, `build_system_prompt`, `intent_classifier_prompt`) but delegates internally to `PromptManager`. Existing callers (`LLMPlanner`, `context_answer_service`, etc.) don't change this PR. They can migrate to `PromptManager` directly in future PRs.

The `load(name)` method accepts both `'chat_mode.md'` and `'chat_mode'` forms — strips the `.md` suffix if present, treats the result as a template_id.

### Env override format

`AGENT_PROMPT_VERSION_OVERRIDE='chat_mode=v2,edit_mode=v3'`

Comma-separated `id=version` pairs. Invalid entries are logged once and ignored. Unset = defaults.

### Missing template handling

If `<template_id>/<version>.md` doesn't exist, `PromptManager.render` raises `PromptNotFoundError(template_id, version)`. Currently `PromptRepository.load` returns `''` on missing file — this is a footgun (silently rendered empty prompt). The shim preserves that old behavior for backcompat (returns empty string) but the new `PromptManager.render` raises. New callers should use the strict path.

## Tests

`tests/test_prompt_manager.py`:
1. **Render default version** — `render('chat_mode')` returns v1 content.
2. **Render explicit version** — `render('chat_mode', version='v1')` matches.
3. **Missing template raises** — `render('nonexistent')` raises `PromptNotFoundError`.
4. **Missing version raises** — `render('chat_mode', version='v99')` raises.
5. **Env override applies** — set `AGENT_PROMPT_VERSION_OVERRIDE='chat_mode=v1'`, assert `choose_version('chat_mode')` returns `'v1'` (with `v1` being the only existing version).
6. **PromptRepository shim** — `PromptRepository().build_system_prompt('chat', {})` returns non-empty string matching the old shape (base + mode + context json).

Existing tests for prompt use (`tests/test_prompt_repository.py` if present) must still pass unmodified.

## Checklist

- [ ] `PromptManager` class in `manager.py`
- [ ] `choose_version` function with env override parsing
- [ ] `PromptNotFoundError` exception
- [ ] `templates/` directory structure created
- [ ] Five existing `.md` files moved into `templates/<id>/v1.md` (content unchanged)
- [ ] `PromptRepository` delegated to `PromptManager` (shim)
- [ ] 6 unit tests pass
- [ ] Full `node scripts/test_agent_unit.mjs` — same failure set as baseline
- [ ] Existing `test_prompt_repository.py` (if any) — still passes unchanged

## Acceptance

- `PromptRepository.build_system_prompt('chat', {})` output byte-identical to pre-PR
- `PromptRepository.load('chat_mode.md')` still returns the same text
- `PromptManager.render('chat_mode')` returns the same v1 text
- `AGENT_PROMPT_VERSION_OVERRIDE='chat_mode=v1'` is a no-op (v1 is default), but `='chat_mode=v2'` raises when called (v2 doesn't exist yet; future PR adds v2)
- No changes needed in LLMPlanner or other existing prompt consumers

## Rollback

Revert the PR. The shim means no caller is forced to switch; reverting puts the `.md` files back at their old paths.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Existing call site uses `PromptRepository.load('chat_mode.md')` and expects exact flat-path caching | Shim preserves method signature and return shape; content is read from the same template file (just relocated). LRU cache preserved. |
| Git blame breaks when files move | Use `git mv` (or `git-mv` equivalent via rename-aware diffs). Content is unchanged so rename detection works. |
| Env override bug silently renders wrong version | `choose_version` logs a `log_event` line `prompt.version_override_applied` when a non-default is picked. |
| Future template additions forget the `v1/` prefix | `PromptManager.__init__` scans `templates/` on first use and asserts each subdirectory has at least one `v*.md` file; raises clearly if malformed. |

## Ledger

| Step                                           | Status | Notes |
|------------------------------------------------|--------|-------|
| `PromptManager.render` + `choose_version`      | [x]    | `session_id` param reserved for A/B hook, unused today |
| `PromptNotFoundError` exception                | [x]    | Strict failure mode; old shim still returns `''` for backcompat |
| Templates moved to `templates/<id>/v1.md`      | [x]    | 6 files (`base_system`, `chat_mode`, `edit_mode`, `plan_mode`, `query_mode`, `intent_classifier`) via `git mv` |
| `PromptRepository` shim                        | [x]    | Delegates to `PromptManager`. `_format_context` / `_safe_default` re-exposed for existing test patches |
| Env override parsing                           | [x]    | `AGENT_PROMPT_VERSION_OVERRIDE='id=v,id=v'`; malformed entries logged + ignored |
| Unit tests                                     | [x]    | 13 total: 5 PromptManager render, 3 choose_version, 5 PromptRepository shim |
| Full-suite baseline parity                     | [x]    | 189 tests; same 10F+9E as baseline (was 176 pre-6a) |
| Existing `test_prompt_repository.py` still green | [x]  | 8/8 OK — `_format_context` preserved on shim |
| Added to default test runner                   | [x]    | `scripts/test_agent_unit.mjs` |

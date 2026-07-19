---
name: ui-audit
description: Run the Playwright audit harness (route coverage, dark-mode captures, hover states) and review results against Proyekto theme and brand rules. Use for UI regression sweeps and theme/accessibility checks.
---

# Skill: UI Audit

Prereqs: web dev server running on localhost:3000 and Playwright auth done (`cd web && npm run pw:auth`; needs PLAYWRIGHT_EMAIL/PASSWORD in web/.env).

## Harness (run from web/)

- `npm run pw:audit:routes` - asserts route coverage; a new route missing from the audit list fails here (fix by registering the route in the audit config under web/playwright/audit/).
- `npm run pw:audit:dark` - dark-theme captures across pages (including public pages).
- `npm run pw:audit:hovers` - hover-state captures for interactive elements.

Screenshots land in the audit output dirs under web/ - report their paths for flagged pages.

## Review rubric

- **Hardcoded colors betray themselves in dark captures**: theme tokens adapt to dark mode, raw hex does not. Any element that looks identical-but-wrong in dark mode is a token violation (rule: bg-primary/text-primary/blue-600 scale, never hex).
- **Hover states**: interactive elements need a visible hover treatment; flag dead hovers.
- **Route registration**: every new page must be in Header.tsx validPaths AND the audit route list.
- **Brand**: user-facing copy says "Proyekto" - flag any "Prodigy" sighting in captures.
- **Mobile**: the responsive capture harness in web/playwright/audit/ can be pointed at mobile viewports; prod CORS blocks localhost:3000, so audit against the local dev server only.

## Output

Pass/fail per audit command, flagged pages with screenshot paths, and a concrete fix per finding (which component, which class/token).

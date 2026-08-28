---
name: proyekto-video
description: Proyekto's own video assets - the remotion/ project, what it renders, and how clips get into web/public/. Use when creating, editing, or re-rendering a Proyekto marketing clip, or when a video in web/public/ needs to change.
---

# Skill: Proyekto Video Assets

Repo-specific companion to Remotion's official skills. **For framework questions — the API,
markup patterns, rendering flags, upgrades — use those instead**: `/remotion-best-practices`
routes to the right one, `/remotion-markup` for animation code, `/remotion-render` for
export, `/remotion-docs` to search the docs. This skill only covers what those cannot know:
how video fits into *this* repo.

## Where things are

`remotion/` at the repo root is a standalone project — **not** one of the six deployable
units. It has its own package.json and node_modules; never mix its deps into `web/`.
Nothing imports from it at runtime. Output is committed into `web/public/` as static files,
which `web/worker.ts` serves via `env.ASSETS.fetch` with no extra wiring.

**`remotion/README.md` is the authoritative reference** for the exact render commands and
this project's gotchas. Read it before changing anything there.

Current assets — three explainers, 1920×1080, 30fps, 330 frames (11s), built to loop
seamlessly:

| Composition | Story | Output | Embedded on |
| --- | --- | --- | --- |
| `TalentStory` | profile → terms → staffing → paid | `web/public/talent-story.mp4` | `/start-selling` |
| `ConsultantStory` | scope → roadmap → team → terms | `web/public/consultant-story.mp4` | `/start-selling` |
| `McpStory` | connect → scopes → in use → control | `web/public/mcp-access.mp4` | `/settings/mcp-tokens` |

The player is `web/src/components/common/ExplainerVideo.tsx` — poster layer,
reduced-motion path and the `steps` text alternative live there, once.
`web/src/components/marketplace/AudienceVideo.tsx` only adds the marketplace framing.
Clip constants: `TALENT_CLIP` / `CONSULTANT_CLIP` in `web/src/routes/start-selling.tsx`,
`MCP_CLIP` in `web/src/routes/settings/mcp-tokens.tsx`.

## Changing a clip

1. `cd remotion && npm run dev` — iterate in the Studio. Rendering takes minutes; the
   Studio is instant.
2. `npm run lint` (`eslint src && tsc`) — the only quality gate in that project.
3. Render and install per `remotion/README.md`.
4. **Bump the `?v=` query** on that clip's constant. Filenames are stable and served with a
   browser cache, so the version param is what forces a refetch. This is the convention
   `HeroSection.tsx` set for `hero-highlight.mp4`.
5. **Keep `steps` in sync with the captions baked into the clip.** `steps` is the video's
   text alternative — the video is `aria-hidden` and its captions are pixels, so `steps` is
   the only version of that content a screen reader ever gets.
6. `cd web && npm test` — the page is guarded (see below).

## Rules specific to this repo

- **Raw hex is correct inside `remotion/`, and wrong in `web/src`.** The guards at
  `web/src/components/marketplace/{talent,consultant}/landing/*Theme.test.ts` reject raw
  hex and fixed palette classes (`bg-white`, `bg-slate-500`, …), and they also check
  `web/src/routes/start-selling.tsx`. Use theme tokens in web/; `bg-black` and
  `text-white/85` are permitted and already used on that page.
- **A baked MP4 cannot follow the page theme.** Clips sit on a self-contained navy ground
  (`#0F1A2E`) so they read as a deliberate inset on both light and dark. No single colour
  separates by luminance from both `#F9FAFB` and `#0E0F0F` — on dark themes the hue
  difference plus the wrapper's `rounded-2xl border border-border` is what does the work,
  so that wrapper is not optional.
- **Ship a poster.** `AudienceVideo` renders it as a real layer under the video, not just
  the `poster` attribute, so the panel is never an empty box before load or under
  `prefers-reduced-motion` (where the video is hidden outright).
- **Budget: under ~500KB per MP4.** For reference, `hero-highlight.mp4` is 1.5MB because it
  is a screen recording; flat vector art should land far below that.

## Verify a loop before shipping

Render the first and last frame and compare — this catches a transform that never returned
to its start pose, which is invisible in the Studio but jumps on every loop:

```bash
npx remotion still <Composition> out/a.png --image-format=png --frame=0
npx remotion still <Composition> out/b.png --image-format=png --frame=327
ffmpeg -i out/a.png -i out/b.png -lavfi psnr -f null -   # expect > 60 dB
```

## Other video in the repo

`web/public/hero-highlight.mp4` is **not** Remotion — it is a Playwright screen recording
of the real app, produced by `web/playwright/record-highlight.mjs` (and
`record-highlight-mobile.mjs` for the portrait cut) and re-encoded with ffmpeg. Different
tool, different workflow; don't try to regenerate it from `remotion/`.

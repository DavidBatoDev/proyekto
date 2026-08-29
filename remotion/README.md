# remotion/ — programmatic video

Proyekto's motion graphics, authored as React components and rendered to MP4.
Standalone: its own `package.json` and `node_modules`, not one of the six
deployable units. Nothing imports from here at runtime — the output is committed
into `web/public/` as static files.

## What lives here

Three explainer clips — two for `/start-selling`, one per audience, and one for
the MCP Access settings page:

| Composition | Story | Rendered to |
| --- | --- | --- |
| `TalentStory` | profile → terms → staffing → paid | `web/public/talent-story.mp4` |
| `ConsultantStory` | scope → roadmap → team → terms | `web/public/consultant-story.mp4` |
| `McpStory` | connect → scopes → in use → control, as a chat thread | `web/public/mcp-access.mp4` |

All are 30fps, 330 frames (11s), and built to loop seamlessly. The first three
are 1920×1080. The three `Hero*` clips are 1200×900: they are the slides of the
marketplace hero carousel, filling the 30% column of a 70/30 band where a 16:9
strip would be a letterbox slot. They are light, caption-free, and use bars
rather than prose — at the ~340px they render into, a real sentence is a smear.

The two `/start-selling` clips are navy; `McpStory` is **light**. `Stage` takes a
`palette` and provides it through context, so every primitive follows whichever
one a composition picks — see `brand/palette.ts` for both, and for why a light
clip leans on the embed's border instead of luminance to draw its edge.

## Commands

```bash
npm run dev     # Remotion Studio — scrub the timeline, instant feedback
npm run lint    # eslint src && tsc — the only quality gate here
npx remotion compositions   # list registered ids
```

Preview in the Studio before rendering. Rendering takes minutes; the Studio is
instant.

## Rendering

```bash
npx remotion render TalentStory     out/talent-story.mp4 \
  --codec=h264 --crf=28 --image-format=png --pixel-format=yuv420p \
  --x264-preset=slower --muted

npx remotion render ConsultantStory out/consultant-story.mp4 \
  --codec=h264 --crf=28 --image-format=png --pixel-format=yuv420p \
  --x264-preset=slower --muted
```

Every flag is load-bearing:

- `--image-format=png` **overrides `Config.setVideoImageFormat("jpeg")`** in
  `remotion.config.ts`. The jpeg default chroma-subsamples each intermediate
  frame before x264 sees it, which smears the thin blue rims — and PNG
  intermediates encode *smaller*, because they carry no JPEG ringing.
- `--crf=28` — Remotion's h264 default is 18, roughly 4× the bitrate for no
  visible gain on flat vector art. 24 and 28 were compared frame-by-frame here;
  28 was indistinguishable at half the size.
- `--pixel-format=yuv420p` is required for Safari/iOS playback.
- `--muted` guarantees no silent audio track.

### Posters

```bash
npx remotion still TalentStory     out/tp.png --image-format=png --frame=300
npx remotion still ConsultantStory out/cp.png --image-format=png --frame=302
npx remotion still McpStory        out/mp.png --image-format=png --frame=270
ffmpeg -y -i out/tp.png -c:v libwebp -quality 86 -compression_level 6 out/talent-story-poster.webp
ffmpeg -y -i out/cp.png -c:v libwebp -quality 86 -compression_level 6 out/consultant-story-poster.webp
ffmpeg -y -i out/mp.png -c:v libwebp -quality 86 -compression_level 6 out/mcp-access-poster.webp
ffmpeg -y -i out/hp.png -c:v libwebp -quality 86 -compression_level 6 out/hero-brief-poster.webp
```

The frames come from `POSTER_FRAME` in `src/brand/timing.ts`. `--image-format=webp`
is rejected for a video composition (png/jpeg only), hence the ffmpeg step.

### Installing into web/

```bash
# +faststart lets the browser start playing before the file finishes downloading
ffmpeg -y -i out/talent-story.mp4     -c copy -movflags +faststart ../web/public/talent-story.mp4
ffmpeg -y -i out/consultant-story.mp4 -c copy -movflags +faststart ../web/public/consultant-story.mp4
ffmpeg -y -i out/mcp-access.mp4       -c copy -movflags +faststart ../web/public/mcp-access.mp4
cp out/*-poster.webp ../web/public/
```

Then **bump the `?v=` query** on the clip constant: `TALENT_CLIP` /
`CONSULTANT_CLIP` in `web/src/routes/start-selling.tsx`, `MCP_CLIP` in
`web/src/routes/settings/mcp-tokens.tsx`. Filenames are stable and served with a
browser cache, so the version param is what forces a refetch. If you change what
a clip shows, update that entry's `steps` too — it is the video's text
alternative and must not drift from the captions on screen.

Budget: keep each MP4 under ~500KB. Current output is 240KB / 268KB / 208KB.

## Structure

```
src/
  Root.tsx              registers both compositions
  anim.ts               lerp / springIn / envelope / bezier
  brand/
    palette.ts          DARK_PALETTE + LIGHT_PALETTE, as raw hex, and the context
    timing.ts           FPS, DURATION, BEATS, seam + poster frames
    fonts.ts            Sora + Manrope, loaded at module scope
  primitives/
    Stage.tsx           panel ground, dot grid, grain, baked rim, palette provider
    shapes.tsx          Card / Bar / Chip / Avatar / Badge / CheckMark / Connector
    Caption.tsx         the beat captions, the only <Sequence> users
  stories/
    TalentStory.tsx
    ConsultantStory.tsx
    McpStory.tsx
```

## Gotchas that already bit

- **`useCurrentFrame()` inside `<Sequence>` returns a *local* frame.** Scene
  elements that morph across beats read the global frame and therefore live
  outside every Sequence. Only the captions are wrapped.
- **`interpolate` defaults to `extrapolate: "extend"`** — an opacity happily
  climbs past 1. Use `lerp` from `anim.ts`, which clamps both ends.
- **`spring()` returns exactly 0 at frame 0** and never converges to exactly 1.
  Springs are for entrances only; anything returning to the seed pose uses
  `lerp` + `EASE_OUT`, which lands exactly. This matters — the loop depends on
  the last frame matching the first.
- **The loop is verifiable**: render frame 0 and frame 327 and compare.
  `ffmpeg -i a.png -i b.png -lavfi psnr -f null -` should report >60 dB. Frame
  327 still carries ~8% of the closing caption, so a long fourth line costs a
  few dB on that comparison without being a real seam defect — `McpStory` reads
  57.2 dB there, and 53.6 dB between the *encoded* first and last frames, where
  the two navy clips score 49.4 and 50.2.
- **Tailwind tokens from `web/` do not exist here.** `src/index.css` is one
  `@import "tailwindcss"` line; `bg-primary` or `border-border` render nothing.
  All colour comes from `brand/palette.ts` as inline styles, which is required
  anyway since a class cannot be interpolated per frame.
- **`defaultProps` is JSON-serialized** on its way to the renderer. Passing a
  React component through it arrives as `undefined` (React error #130).
- **`<Freeze>` inside a one-frame `<Still>` is clamped** and renders frame 0.
  Use `remotion still <VideoComposition> --frame=N` instead.
- **`tsconfig.json` sets `lib: ["es2015"]` and `noUnusedLocals: true`** — no
  `Object.entries`, no `String.padStart`, and a `_` prefix does *not* exempt an
  unused local.
- **Never bump one `@remotion/*` package alone.** Use `npm run upgrade`; the
  versions must match exactly.

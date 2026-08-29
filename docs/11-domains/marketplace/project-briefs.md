# Project Briefs

> **Last updated:** 2026-08-29 · **Status:** current

Until now the marketplace ran in one direction: a verified consultant found and invited
talent. A client had no way to describe work and have consultants come to them — the
`bidding` project status existed with no listing surface behind it. Project briefs are
that missing direction. A client writes a **brief** — a flexible, section-based
description of the work, with an attached roadmap and files — publishes it, and verified
consultants apply with a short pitch and an indicative rate. The brief is **standalone**:
no project exists behind it until the client decides to act on somebody's proposal.

## Why not `project_briefs`

`project_briefs` is a different thing that shares a word. It is the brief **inside** a
project: `project_id` is `NOT NULL`, its RLS is scoped to `project_access`, and it
presumes a project already exists. A posting exists *before* any project does and is read
by people who must never receive project access. Sharing one table would mean loosening
project-scoped RLS to admit strangers.

The two are coupled at exactly one point, deliberately: the element shape of
`project_postings.sections` is identical to `project_briefs.custom_fields`
(`{key, value, position}`), so a brief can later seed a real project's brief verbatim.

Naming follows that split — **`project_postings*` in code and SQL, "project brief" in the
interface**.

## Tables

| Table | Holds |
| --- | --- |
| `project_postings` | The brief: title, `engagement_type`, `summary` (rich HTML), `sections` jsonb, taxonomy ids, budget range, `duration`, optional `roadmap_id`, `status` (draft \| published \| closed) |
| `project_posting_attachments` | Supporting files. Columns mirror the web upload service's `ChatAttachmentMeta` so the existing R2 path needs no translation |
| `project_posting_proposals` | One row per consultant per brief (`UNIQUE (posting_id, consultant_id)`): `pitch`, `indicative_rate`, `rate_unit`, `status` |

Migration: `supabase/migrations/20260826100000_project_postings.sql`, plus
`20260826100100_project_posting_proposal_update_guard.sql`.

No columns were added to `projects`. Per
[Data → schema overview](../../07-data-and-db/schema-overview.md), that table is the lean
execution container and marketplace listing metadata does not live in it.

## Who sees what

```
  author (any signed-in user)          verified consultant           everyone else
        |                                     |                            |
        |-- draft ......... visible           |-- draft ....... invisible  |-- nothing,
        |-- published ..... visible           |-- published ... visible    |   in any state
        |-- closed ........ visible           |-- closed ...... invisible  |
        |                                     |
        |-- reads every proposal              |-- reads only its own proposal
        |-- may set shortlisted / declined    |-- may edit or withdraw its own
```

Authoring is open to **any** signed-in user: "is this person a client?" is a malformed
question, and publishing a brief is what makes somebody the client of that piece of work.
Discovery and proposing are consultant-only — the same gate the talent pool uses, as
pre-decided in
[Proposals → identity and enrollment](../../13-proposals/identity-and-enrollment.md).
There is no `anon` policy on any of the three tables.

Two rules are enforced below the API, because RLS alone cannot express them:

- **The author may triage, and only triage.** The RLS `WITH CHECK` bounds them to
  `shortlisted` / `declined`, but a `WITH CHECK` never sees the old row, so it cannot stop
  `SET status='shortlisted', pitch='...'` in one statement. A `BEFORE UPDATE` trigger
  freezes every content column against anybody but the applicant. This was found by
  probing the policy against hosted dev, not by reading it.
- **A proposal is never deleted.** There is no `DELETE` policy: a consultant withdraws
  (a state the author can see) and an author declines. Neither erases the record.

## An attached roadmap is a reference, not a grant

A brief may point at one of the author's roadmaps. A consultant reading the brief sees its
**name and node counts** — never its contents. Project authorization remains
`project_access` and `share_role`, and roadmap reading remains `roadmap_shares`; a posting
introduces no third path. A client who wants consultants to actually read the roadmap
shares it through the existing tokenized flow, where
[sharing never grants edit](../roadmap-sharing/README.md).

## Timeline

Nine buckets from *Under 1 week* to *More than a year*, plus *Ongoing / no end date* and
*Not sure yet* — and, when none of them is true, **Something else** with a short line in
the author's own words ("about ten weeks", "before our May launch"). That last one is a
closed value, `custom`, paired with a separate `duration_custom` column: the shape this
codebase already uses for "other" (`payout_methods`, `specialization_category`), so the
board keeps filtering on exact equality over a known vocabulary and never has to match
prose. `custom` is not offered as a filter, because there is nothing to compare it to.

The vocabulary lives in one place, `web/src/lib/durations.ts`, and is mirrored by the
CHECK on `project_postings.duration` and the `DURATIONS` tuple in the DTO. The project
wizard imports the same list rather than keeping the hand-copied twin it used to. Two
values — `<1_month` and `6+_months` — are retired from the picker but still valid and
still labelled, because briefs written before
`20260829120000_project_posting_duration_options` have them.

Two rules the database cannot express alone:

- **Only `custom` may carry free text.** The DB refuses the mismatched pair; the service
  clears `duration_custom` on every write where `duration` is not `custom`, so a change of
  mind cannot leave a sentence contradicting the bucket beside it.
- **"Something else" with an empty box is not an answer.** It passes the CHECK — a draft
  has to be saveable mid-thought — and is rejected by `missingPublishFields`, exactly like
  no timeline at all.

## What makes a brief publishable

Publish is rejected server-side unless the brief carries an overview, a budget (either
end of the range), a timeline (see above for what counts as one) and a category. Those are exactly the **structured** fields
the board filters on — a brief nobody can filter for is a brief nobody finds. No
particular *prose* section is ever required: sections are the flexible part, and demanding
specific headings would defeat the point.

The editor's "N missing fields" counter mirrors `missingPublishFields` in
`backend/src/modules/marketplace/postings/postings.service.ts`. The server is the
authority; the client copy is a convenience. Change one, change both.

## HTTP

All under `/api/postings`, guarded by `SupabaseAuthGuard`; the consultant-only routes add
`ConsultantOnlyGuard`.

| Route | Who |
| --- | --- |
| `POST /postings`, `GET /postings/mine`, `GET /postings/:id`, `PATCH /postings/:id` | author |
| `POST /postings/:id/publish`, `POST /postings/:id/close`, `DELETE /postings/:id` | author |
| `POST /postings/:id/attachments`, `DELETE /postings/:id/attachments/:attachmentId` | author |
| `GET /postings/:id/proposals` | author |
| `GET /postings/board` | verified consultants |
| `POST /postings/:id/proposals`, `POST /postings/proposals/:id/withdraw`, `GET /postings/proposals/mine` | verified consultants |
| `PATCH /postings/proposals/:id` | author (shortlist / decline) |
| `POST /postings/generate` | any signed-in user (see below) |

A non-party fetch returns **404, not 403**, so the endpoint cannot be used to probe which
brief ids exist — the same posture the engagement routes take.

Unlike the existing brief, everything here goes through NestJS.
`project_briefs` is written directly from the browser under RLS and now has two divergent
write paths and no server-side validation of its own; this domain does not repeat that.

## The AI generator

One box of prose becomes a drafted brief. The flow is
**web → NestJS → Python agent**, which inverts the roadmap AI's web-→-agent path on
purpose: every other agent endpoint ends at NestJS for the data it touches, so
authorization is enforced on the way through, while this one touches no data and only
spends OpenAI credits. Left unauthenticated it would be a metered open proxy.

- **Agent:** `POST /briefs/generate` (`agent/app/api/routes/briefs.py`) — a single
  structured-output call in `agent/app/core/briefs/generator.py`, pinned to a strict JSON
  schema. It deliberately does **not** run the v2 tool-calling loop and does not touch
  `schemas/roadmap-ai-operations.json`.
- **Shared secret:** `AGENT_INTERNAL_TOKEN`, checked by the agent. Unset outside
  development fails the endpoint closed. The backend sends it only when it has one and
  gates solely on `AGENT_API_URL`, so a local agent running in development mode needs no
  secret at all.
- **Running it locally:** start the agent (port 8010) and set `AGENT_API_URL=http://localhost:8010`
  in the backend. Without that the button 503s and the brief is written by hand.
- Generated text is a **draft the author approves**, never an auto-publish, and is treated
  as untrusted data rather than instructions.

## Web surfaces

| Path | What |
| --- | --- |
| `/brief/new` | The one-box start **and** the editor, in two steps of one route. "Generate brief" and "Write it myself" both open the editor in place; no row exists yet |
| `/brief/$briefId/edit` | The same editor over a saved brief. Also where a brief is deleted |
| `/brief/$briefId` | The brief as it reads. The author sees the applicant list; a consultant sees the apply panel |
| `/marketplace/briefs` | The board. Consultant-only; anybody else gets the "become a consultant" pitch |
| `/dashboard` | **Your briefs** — every brief this person has written, drafts included, plus the one still unsaved in this tab |

`/brief` is registered in `Header.tsx`'s `validPaths`, and the brief pages carry their own
header. Both routes render the same `components/brief/BriefEditor.tsx`, which owns no state
and calls no service — that is what lets it run with no brief behind it.

The overview and every section are written **in place**, notebook-style
(`components/brief/InlineRichText.tsx`): a block reads as finished prose until it is
clicked, and only the clicked block mounts a rich-text editor. Clicking away, pressing
Escape or hitting Done closes it. Sections were first edited in a dialog, which was wrong
twice over — it covered the rest of the brief at the moment the author most needs to see
it, and it made writing a section feel like a different act from writing the overview
directly above.

## Nothing is created until the author saves

Opening the editor writes nothing. Neither does typing, attaching a file, or picking a
roadmap. The row appears on **Save draft** or **Post your brief**, and not before.

That is a correctness rule, not a nicety. Creation-on-open left an `Untitled brief` behind
every time somebody opened the page and changed their mind, and `PostingsService.create`
caps an author at 25 unpublished briefs — so the litter accumulated against a real limit,
in a list that at the time nothing rendered.

Until the save, the brief lives in the browser:

| What | Where | Why there |
| --- | --- | --- |
| Title, sections, budget, the picked roadmap | `sessionStorage`, `proyekto_brief_draft` (`lib/briefDraftStorage.ts`) | Per-tab, so two tabs are two independent drafts — each will create its own row, and merging them would be worse than keeping them apart |
| Attached files | IndexedDB, `proyekto` → `pending_brief_files` (`lib/pendingFileStore.ts`) | A `Blob` is not JSON. This is the repo's only IndexedDB use |

Both fail soft: a browser that refuses storage still runs the editor, the draft simply
does not survive a refresh. A tab closed on an unsaved draft takes its `sessionStorage`
with it but leaves the blobs behind, so `prunePendingFiles()` on mount drops anything
older than a week.

`lib/briefCommit.ts` owns the one order that is safe:

```
create (or update) the row
  └─ record the new id LOCALLY, before any upload      <- the double-create guard
     └─ per file: upload to R2 -> addAttachment -> drop the local blob
        └─ clear the stored draft
           └─ publish, if that is what was asked
```

The id is recorded before a single byte moves, so a retry after a failed upload updates
that brief instead of creating a second one. A file failing does not abort the loop or the
save: the successful ones are attached, the failures stay in the strip marked *Not saved*,
the page does not navigate, and pressing the button again retries only what is left.
A brief with a failed upload is **not** published — a live brief missing its spec is worse
than one still in draft.

This is the same rule `lib/pendingImages.ts` states for every other picker in the app:
nothing reaches R2 until the user saves.

### The marketplace says "Post a brief"

Every marketplace call to action — the hero toggle and its submit button, the browse-page
tile, the empty-state panel, the footer, the category page, the public consultant profile,
the marketplace sidebar item — reads **"Post a brief"** and goes to `/brief/new`. It used
to read "Post a project", which named the wrong thing: they all sit under copy promising
that a vetted consultant scopes the work, and that is what a brief buys. `/project/new` is
the other thing entirely (run your own project) and is reached from the dashboard and the
execution sidebar, where the link says "Post a project brief" precisely because the
contrast with project creation needs drawing.

The hero hands its typed line over as `?need=`, which seeds the describe-your-project box
so nobody types the same sentence twice.

### Finding a brief again

`/dashboard` carries a **Your briefs** section (`components/home/BriefsGrid.tsx`) listing
every brief the viewer has written — a draft opens in the editor, a published or closed one
opens as it reads. It also shows the brief still sitting unsaved in that tab, because a
draft nobody can see is a draft nobody finishes. Delete lives in the editor header, behind
`AppConfirmDialog`; the backend `remove` takes a brief in any state, so the confirm copy
says plainly that a published brief takes its proposals with it.

`mapLegacyPath` still sends the retired `/marketplace/project-posting` to `/project/new`.
That is deliberate: those URLs are persisted in notification rows and push payloads written
when the path really did create a project, and rerouting them to a different feature would
change what an old link does.

## Rollout

No feature flag: the surfaces ship on. The generator has its own dormancy instead —
`AGENT_API_URL` and `AGENT_INTERNAL_TOKEN` unset means `BriefGeneratorService.isConfigured`
is false and "Generate brief" returns a 503 the editor turns into "write it yourself".
Hand-authoring a brief never depends on the agent being reachable.

`projects.status = 'bidding'` is deliberately untouched. Client-mode project creation still
writes it and three dashboard surfaces still render it; the board reads `project_postings`
and never that enum, so pre-existing bidding rows cannot leak into a listings surface.

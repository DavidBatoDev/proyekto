Proyekto has iOS and Android apps, and they are the same Proyekto you use in a
browser — same account, same workspaces, same projects, same data. There is
nothing to sync and no separate mobile account. A few surfaces are deliberately
left out, which is the part worth reading before you go looking for them.

## Signing in

Install the app, sign in with the account you already have — email and password
or Google, the same two options as the web. Everything you have access to is
there the moment you are in: your workspaces, the projects you have been granted
access to, chat, meetings, your assigned work. See
[Your account](/docs/account-and-apps/your-account).

## What is not in the app

Two things are missing on purpose:

- **The marketplace.** Finding consultants, posting a brief, contracts and
  invoices all live on the web. The app carries your workspace and the delivery
  work inside it.
- **Every page that shows a price or sells a plan.** Plan and billing management
  happen in a browser.

> Your workspace's plan applies in the app in full. It simply is not managed
> from your phone.

Nothing about your plan changes because you opened the app — the limits, the
features and the tier are identical. Only the screens where you would *change*
the plan are absent.

Those pages are still reachable in principle: an old push payload, a
notification written months ago, a link in an email. Rather than 404 or fail
silently, the app lands you on a short screen that says the page is web-only and
why. If you see it, that is the app being explicit, not a bug.

## Notifications and push

Push notifications exist only in the installed app, and the app asks for
permission the first time it makes sense to. If you decline, you can grant it
later in your phone's own settings — Proyekto cannot re-ask on your behalf once
the OS has recorded a refusal.

**Settings → Notifications** in the app shows live registration status for that
device, which is the first place to look if pushes are not arriving.
[Notifications](/docs/account-and-apps/notifications) covers the full set of
controls, all of which apply across web and mobile together.

## Updates arrive over the air

Proyekto ships app updates over the air. The app fetches the new bundle and
applies it on next launch, which means most improvements reach you **without a
store update**. Occasionally a change needs new native code and then a store
update is required — the app will tell you when that is the case. In practice:
if a feature appeared on the web this week, it is probably already on your phone
too.

## Getting around

Inside a project, a **bottom bar** carries the five places people go most:

- Overview
- Roadmap
- Board
- Timeline
- Chat

Everything else lives behind **More**, which opens a sheet with Resources, the
four governance registers (Deliverables, Change Requests, Risks & Issues,
Decisions), Team, Activity, Time logs and project Settings. The split is purely
about how many labels fit legibly on a phone — the More sheet is not a
second-class area, and the pages in it are the same pages.

Outside a project, the navigation drawer reaches your dashboard, teams,
[Command center](/docs/roadmaps-and-work/command-center) and inbox.

## What a phone is good at, and what it is not

Be realistic about screen size. Some of Proyekto is genuinely better on a
phone, and some of it is a large-screen tool you can read on a phone.

**Comfortable on a phone**

- Chat and DMs — arguably better than on a laptop.
- Your assigned work: checking a task, moving it along, adding a comment.
- The **Timeline**, which has a real touch view rather than a shrunken chart.
  This is why it sits in the bottom bar at all.
- The **Board**, for dragging a card between columns.
- Reading registers, meetings and activity.

**Happier on a large screen**

- The **roadmap canvas**. It is a spatial view of a whole tree of epics,
  features and tasks; you can pan it on a phone, but structuring a plan there is
  a desk job.
- Long-form writing — a brief, a decision with several options, a deliverable's
  acceptance criteria.
- The AI assistant's proposal review, where you want the semantic diff and the
  roadmap side by side. See
  [Reviewing what the AI changed](/docs/ai-assistant/reviewing-changes).

A reasonable division of labour: plan and structure on a laptop, run the work
and talk to people from your pocket.

The member list on your workspace's Members tab is two things at once: the
people who belong to your organisation, and the seats your plan is counted
against. Adding someone adds a seat; removing them frees one. What it does
*not* do is give anyone sight of your work — that is a separate grant, made
project by project.

## The member list is the seat pool

Every member of a workspace occupies one seat, and on a paid plan the
workspace is billed per seat. There is no "free" category of member and no
read-only seat: if someone is on the list, they are a seat.

Pending invites hold a seat too. Someone you have invited but who has not yet
accepted is counted as though they were already in, which is why the Billing
tab shows *Seats in use*, *Seats billed* and *Invited* as separate numbers.
That is deliberate — if invites did not count, a workspace at its member limit
could invite unlimited people and only discover the problem when they tried to
accept.

## Inviting someone

Owners and admins invite by email from the Members tab. Proyekto looks the
address up: an existing Proyekto account gets a notification and an email, and
an address with no account gets an email inviting them to sign up. Either way
the invite sits as **pending** until it is accepted, and you can re-send or
cancel it from the same list.

Once someone accepts, they are a member — and here is what they can see:

> A brand-new workspace member can see the workspace exists, who else is in
> it, and nothing else. No projects, no roadmaps, no chat, no files.

Somebody has to grant them project access before they have any work to do.
Doing that person by person is described in
[Project access and roles](/docs/projects/access-and-roles); doing it for five
people at once is what [Teams](/docs/teams-time-and-rates/teams) are for.

## Two ladders, not one

Workspace roles and project roles are different systems that happen to reuse
some words. Neither one implies the other.

| | Workspace role | Project role |
| --- | --- | --- |
| Set on | The Members tab | Each project, per person |
| Values | Owner, Admin, Member | Owner, Admin, Editor, Commenter, Viewer |
| Controls | Billing, the plan, invites, the workspace's settings | What you can see and change inside that one project |

A workspace **owner** can change the plan, the URL handle and ownership
itself, and a workspace cannot be left without one. An **admin** manages
members and invites and edits the workspace's general settings. A **member**
is simply in the workspace. None of the three grants a single permission
inside a project, and a project owner need not be a workspace admin.

## At the member limit

Where your plan caps members, reaching that cap blocks one thing: new invites.

Nothing is removed. Nobody is downgraded. Everyone already in the workspace
stays, with exactly the access they had, and every project carries on as
before. The invite button explains the cap when you hit it, and says plainly
that everything you have stays.

Two smaller behaviours follow from invites counting as seats. Re-sending an
invite that is already pending still works at the cap, because it adds nobody.
And if the cap is reached while an invite is outstanding, the person accepting
is told to ask a workspace owner about the plan and to accept again afterwards
— their invite is not thrown away.

See [Limits and usage](/docs/workspaces-and-plans/limits-and-usage) for how
every limit behaves.

## Removing a member

Removing someone from the Members tab takes them off the member list and frees
their seat. A workspace cannot lose its last owner, so that removal is
refused.

What removal does *not* do is tidy up after them, and that is worth
understanding:

- **Project access** is a separate grant, so it is revoked separately, on each
  project's Team page. Take somebody off the member list and their project
  grants are still there to be removed.
- **Comments, chat messages and activity** stay, still attributed to them. A
  record of who said what is the point of having one.
- **Time logs** stay, including approved ones, so timesheets, rates and
  payouts still add up.

If your aim is to cut off access, remove their project access first — that is
the grant that actually opens doors.

## Enterprise: SAML and SCIM

Enterprise workspaces can put membership under an identity provider. **SAML
single sign-on** lets people sign in with your organisation's identity
provider instead of a Proyekto password, and **SCIM provisioning** lets that
provider create and deactivate members directly, so joining and leaving the
company is what changes the seat count. Both are arranged with Proyekto rather
than switched on from the Members tab; see
[Plans](/docs/workspaces-and-plans/plans).

Google sign-in, by contrast, is available on every plan and needs no setup —
see [Your account](/docs/account-and-apps/your-account).

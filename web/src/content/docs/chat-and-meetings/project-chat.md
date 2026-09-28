Chat lives inside a project rather than beside it. Every channel belongs to one
project, which is what keeps one client's conversation out of another client's
project without anyone having to think about it. If you want your messages from
everywhere in one list instead, that is the
[Inbox](/docs/chat-and-meetings/direct-messages-and-inbox).

## Channels

A project's chat is a list of channels in the left rail, and there are two kinds.

**System rooms** are the ones the project comes with, starting with `#general`.
They exist from the moment the project does, but you are not put in them in
advance — you join a system room the first time you open it. That is deliberate:
a project with twenty people should not generate twenty joins for a room nobody
has read yet.

**Channels you create** are for everything else — a workstream, a release, a
conversation with one client contact. When you create one you give it a name and
decide whether it is open to the project or private to the people you add. A
private channel shows a padlock in the rail instead of a hash.

Once a channel exists you can rename it, change its description, add members,
and leave it. Leaving a channel removes it from your rail; it does not delete it
for anyone else.

## Sending a message

The composer does rather more than plain text:

| What | How it behaves |
| --- | --- |
| **Attachments** | Files and images attach to the message that carries them |
| **Replies** | Replying quotes the original and keeps the exchange readable as a thread |
| **Reactions** | Emoji on any message, and you can see who added which |
| **Mentions** | Typing `@` opens a picker of people in the project |

A mention is the only part of a message that reaches someone who is not looking.
It creates a notification for the person named, and depending on their settings
it can follow them to email and to push on their phone — see
[Notifications](/docs/account-and-apps/notifications). Mentioning everyone in a
channel is possible and worth using sparingly, for the obvious reason.

## Editing and unsending

You can edit your own message after sending it. The message updates in place for
everyone and is marked **(edited)** — the marker is not optional, because a
message that changes silently is worse than one that is visibly corrected.

Unsending is different. The content goes, and what stays behind is a small
placeholder reading *This message was deleted*. Anyone who was already looking
at the conversation sees that placeholder rather than the conversation quietly
re-flowing around a gap. Two consequences worth knowing: people who read the
message before you unsent it have already read it, and a reply that quoted it
still shows that its parent is gone.

## Read state

Opening a conversation marks it read up to the newest message in it. Unread
conversations are marked in the rail, and they roll up — a project with unread
chat is flagged wherever that project appears, and the same conversations
surface in your Inbox. Nothing is marked read on your behalf just because a
notification was delivered; reading happens when you open the room.

## Finding things again

Chat accumulates faster than any other surface in a project, so three things
exist to get you back to something:

- **Search** — the conversation's info panel searches the messages in it by
  text, which is the fastest route to "someone posted the staging URL in here".
- **Media, files and links** — the same panel keeps a library of everything
  shared in that conversation, split into media, files and links, so you can
  find an attachment without remembering who sent it.
- **Starring** — star a conversation and it floats to the top of your rail.
  Useful for the two or three rooms you actually live in.

> Chat is a place things get *said*. When something gets *decided*, put it in a
> register so it is still findable in six months — see [Delivery and
> governance](/docs/delivery-governance/overview-governance).

## Who can see chat

Chat is project-scoped and permissioned. Access to a project is granted per
person on the ladder owner > admin > editor > commenter > viewer, and on top of
that there is a chat permission that can be switched off for an individual.
Someone without it does not see a locked page — the surface is simply not in
their sidebar. Being a member of the workspace grants none of this; see
[Project access and roles](/docs/projects/access-and-roles) and [Fine-tuning
permissions](/docs/projects/permissions).

Sharing a roadmap by link never reaches chat, however the link is shared.

## When you want messages across projects

Chat answers "what is happening in this project". For "what is waiting on me
everywhere", use the [Inbox](/docs/chat-and-meetings/direct-messages-and-inbox),
which gathers your direct messages and the conversations you are in, from every
project you have access to.

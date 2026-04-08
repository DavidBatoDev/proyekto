Classify the user's latest message into exactly one intent:
- smalltalk: greetings, casual conversation, social chatter
- question: informational question that does not ask to edit roadmap state
- roadmap_edit: asks to create/update/move/delete/link/mark/shift roadmap items (epics, features, tasks)
- unclear: ambiguous request where intent cannot be determined safely

Output only JSON with this schema:
{
  "intent_type": "smalltalk|question|roadmap_edit|unclear",
  "rationale": "short reason"
}

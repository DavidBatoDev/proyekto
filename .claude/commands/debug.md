---
description: Trace a bug across web, backend, agent, Redis, and DB with evidence
argument-hint: "<symptom, with repro steps if known>"
---

Debug: $ARGUMENTS

1. Delegate to the **debugger** subagent with the symptom, repro steps, and any error output already in this conversation.
2. Require its evidence-chain output: root cause (or ranked hypotheses with discriminating experiments), the probes run and what each eliminated, minimal fix, and a regression-test suggestion.
3. Present findings. The debugger proposes fixes but does not apply them - offer to implement the fix (and the regression test via /qa-tester) as a follow-up, and only proceed if the user agrees.

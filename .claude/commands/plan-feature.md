---
description: Plan a feature end-to-end - context gathering, architecture, rollout plan
argument-hint: "<feature description>"
---

Plan this feature: $ARGUMENTS

1. If the idea itself is still speculative (no clear commitment to build), suggest /validate-idea first and stop.
2. Launch the **research** subagent: prior art in the repo, relevant docs/ sections, PM-tool context if connected (it degrades honestly if not).
3. Launch the **solutions-architect** subagent with the research brief: design + two rejected alternatives + rollout sequence + blast radius per unit.
4. Synthesize into an implementation plan:
   - Ordered checklist by dependency: schema/migration -> backend -> agent -> web (skip layers not touched), with the schemas/ contract step explicit if operation shapes change (/api-contract).
   - Flag-gated rollout stages (ship dark, activate in phases with telemetry) - name the flag(s).
   - Authorization story: guards, RLS, share_role, persona gating.
   - Test plan pointer (/qa-tester) and docs impact (/docs-update).
5. Present the plan and stop - do not start implementing without approval.

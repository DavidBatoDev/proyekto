---
description: Pull ticket/board context from the PM tool if one is connected; report honestly if not
argument-hint: "[ticket id or topic]"
---

Sync PM-tool context for: $ARGUMENTS

1. Delegate to the **research** subagent in PM-discovery mode: it runs ToolSearch to find any connected PM MCP tools (Linear, Jira, Notion, ClickUp, ...) and queries them for the given ticket/topic.
2. Degradation contract - if NO PM tool is connected, the report must:
   - say exactly that, listing which ToolSearch queries were tried;
   - fall back to a "state of play" from repo evidence: recent `git log` themes + relevant docs/ sections;
   - never invent ticket IDs, statuses, or assignees.
3. Present the brief with every finding source-tagged ([PM-tool]/[docs]/[repo]/[web]/[inference]).
4. If no PM tool was found, note once (not repeatedly) that connecting one via `claude mcp add` or claude.ai connector settings would light this command up.

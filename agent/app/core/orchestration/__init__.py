from __future__ import annotations

__all__ = ['AgentService', 'MessagePlanningOutcome', 'EditReactLoopOutcome']


def __getattr__(name: str):
	if name == 'AgentService':
		from app.core.orchestration.agent_service import AgentService

		return AgentService
	if name == 'MessagePlanningOutcome':
		from app.core.orchestration.shared.outcomes import MessagePlanningOutcome

		return MessagePlanningOutcome
	if name == 'EditReactLoopOutcome':
		from app.core.orchestration.shared.outcomes import EditReactLoopOutcome

		return EditReactLoopOutcome
	raise AttributeError(f'module {__name__!r} has no attribute {name!r}')

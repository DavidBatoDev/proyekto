"""Run phases: investigate -> propose -> execute -> verify.

Each module exposes ``run(ctx, session, run) -> PhaseOutcome`` (propose takes
the investigate outcome that triggered it). ``orchestrator.advance`` drives
the transitions.
"""

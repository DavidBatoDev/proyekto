"""Contracts for the project-brief generator.

A client types one paragraph about the work they want done; this turns it into
the sections a brief is made of. Deliberately NOT part of the roadmap operation
contract (schemas/roadmap-ai-operations.json): nothing here edits a roadmap, and
coupling a marketing-shaped text generator to the operation schema would make
every future brief tweak a cross-service contract change.

The output shape mirrors `project_postings.sections` in the database
({key, value, position}) so the backend stores what the model returns without a
translation layer.
"""

from typing import Literal

from pydantic import BaseModel, Field


class GenerateBriefRequest(BaseModel):
    description: str = Field(min_length=30, max_length=5000)
    # Free text, not an id: the agent has no taxonomy table and only uses this
    # to steer tone and vocabulary.
    category_hint: str | None = Field(default=None, max_length=120)


class GeneratedSection(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=20000)
    position: int = Field(ge=0)


class GenerateBriefResponse(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    engagement_type: Literal['ongoing', 'one_time']
    summary: str
    sections: list[GeneratedSection]

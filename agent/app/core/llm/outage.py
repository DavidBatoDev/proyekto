from __future__ import annotations


OUTAGE_CLARIFIER_MESSAGE = (
    'Temporary AI provider issue while handling this request. '
    'Please retry in a moment, or narrow the request to one target.'
)


def build_outage_clarifier_message() -> str:
    return OUTAGE_CLARIFIER_MESSAGE

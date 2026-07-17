"""Shared interface for all data-source clients.

Each concrete client wraps one upstream API (see `.env.example` for the
required credentials) and exposes only the methods each factor/agent
actually needs — no generic passthrough. Per the sovereign data mandate,
these clients must never fabricate a response: on upstream failure they
raise `UpstreamUnavailableError`, they do not fall back to cached, mocked,
or hardcoded data.
"""

from __future__ import annotations

from abc import ABC


class UpstreamUnavailableError(RuntimeError):
    """Raised when an upstream data source is unreachable or misconfigured.
    Callers (agents, factors, scripts) must propagate this, not swallow it.
    """


class BaseDataClient(ABC):
    required_env_vars: tuple[str, ...] = ()

    def __init__(self, **credentials: str):
        missing = [v for v in self.required_env_vars if not credentials.get(v)]
        if missing:
            raise UpstreamUnavailableError(
                f"{type(self).__name__} missing required credentials: {missing}"
            )
        self._credentials = credentials

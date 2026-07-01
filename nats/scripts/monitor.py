#!/usr/bin/env python3
"""Dashboard + alerting entrypoint. Starts a Prometheus metrics HTTP server
exposing the counters/gauges defined in src/monitoring/metrics.py, and
(once implemented) posts circuit-breaker trips and validation-gate
failures to SLACK_WEBHOOK_URL.

Scaffold stub for the alerting path — the Prometheus server itself is
fully wired and safe to run as-is.
"""

from __future__ import annotations

import argparse
import time

from prometheus_client import start_http_server


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NATS v2.0 monitoring server")
    parser.add_argument("--port", type=int, default=9100)
    args = parser.parse_args()

    start_http_server(args.port)
    print(f"Prometheus metrics available at http://localhost:{args.port}/metrics")

    while True:
        time.sleep(60)


if __name__ == "__main__":
    raise SystemExit(main())

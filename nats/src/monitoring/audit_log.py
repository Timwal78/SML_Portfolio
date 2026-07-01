"""Immutable JSONL audit trail (spec non-negotiable #6): every signal, every
trade, every decision logged. Append-only — never rewrite or delete lines.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class AuditEvent:
    event_type: str  # "signal" | "trade" | "risk_decision" | "validation_gate"
    payload: dict[str, Any]
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AuditLogger:
    def __init__(self, log_path: Path):
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event_type: str, payload: dict[str, Any]) -> None:
        event = AuditEvent(event_type=event_type, payload=payload)
        with open(self.log_path, "a") as f:
            f.write(json.dumps(asdict(event), default=str) + "\n")

    def log_signal(self, agent_name: str, symbol: str, signal: int, confidence: float | None = None) -> None:
        self.log("signal", {"agent": agent_name, "symbol": symbol, "signal": signal, "confidence": confidence})

    def log_trade(self, symbol: str, side: str, qty: float, price: float | None, order_id: str) -> None:
        self.log("trade", {"symbol": symbol, "side": side, "qty": qty, "price": price, "order_id": order_id})

    def log_risk_decision(self, symbol: str, approved: bool, reasons: list[str]) -> None:
        self.log("risk_decision", {"symbol": symbol, "approved": approved, "reasons": reasons})

    def log_validation_gate(self, gate_name: str, passed: bool, value: float, threshold: float) -> None:
        self.log("validation_gate", {"gate": gate_name, "passed": passed, "value": value, "threshold": threshold})

#!/usr/bin/env bash
# One-command value demo — free discovery, no API keys, no wallet required.
set -euo pipefail
echo "=== ScriptMasterLabs Agent Economy demo ==="
echo "1) Free remote MCP health"
curl -sS "https://mcp-x402.onrender.com/health" | head -c 400; echo
echo
echo "2) Free RWA asset scan (no payment)"
curl -sS "https://sml-rwa-api.onrender.com/x402/rwa-assets?limit=3" | head -c 600; echo
echo
echo "3) Cheap first hire (ACP)"
echo "   Search scriptmasterlabs -> hire gas_tracker at \$0.01"
echo "   Or rwa_intelligence at \$0.03"
echo "   Remote MCP: https://mcp-x402.onrender.com/mcp"
echo "   npx: npx @scriptmasterlabs/mcp-x402"
echo
echo "=== Done. First paid wedge: gas_tracker \$0.01 or rwa_intelligence \$0.03 ==="

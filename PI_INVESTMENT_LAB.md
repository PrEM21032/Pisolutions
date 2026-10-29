# PI Investment Lab

Status: READ-ONLY INSPECTION + SIMULATED TRADES IMPLEMENTED AND TESTED AGAINST A SYNTHETIC MCP SERVER. NOT YET CONNECTED TO A REAL ROBINHOOD ACCOUNT. NOT DEPLOYED. NO EXECUTION CAPABILITY EXISTS.

## Scope

An owner-side PI module that inspects a brokerage account through Robinhood's MCP server under a read-only permission gateway, runs deterministic quantitative and risk analysis, simulates proposed trades on a local paper ledger, independently verifies the results, and produces a provenance-labelled report.

The lab does **not** submit orders, fund or transfer money, use margin, run automated trading, or expose credentials or account identifiers. It is not wired into the customer chat Worker, the Netlify owner runtime or any deployment.

## Canonical repository check (2026-10-29)

- Canonical source: `pisolutions9/pisolutions9`. It holds the PR history (#208–#218) and the canonical-deploy guard branches.
- This working repository is `PrEM21032/Pisolutions`, a mirror whose `main` is the same commit as upstream `main` (`13c0c94`, verified with `git ls-remote`).
- This module was built on that shared base so it can be proposed upstream unchanged.

## Robinhood MCP: what is and is not verified

| Claim | Status |
|---|---|
| Robinhood operates an official agent MCP server at `https://agent.robinhood.com/mcp/trading` (OAuth sign-in; orders are confined to a dedicated agent account) | **Reported by third-party summaries only.** robinhood.com and the endpoint were blocked by this build environment's network policy (`live-endpoint-probe.json`), so the official pages and tool list were not read. |
| Exact Robinhood tool names and response shapes | **Unknown.** The lab discovers tools at runtime, classifies each one, and fails closed on response shapes it does not recognize. |
| PI's MCP client speaks the protocol correctly | **Verified** against the official MCP TypeScript SDK 1.32.2 in both directions, over JSON and SSE responses, protocol `2025-11-25` (`evidence/sdk-conformance.json`). |

## Architecture

`Owner objective → Krishna (orchestrator.mjs) → Garuda research → Kubera quant → Rama risk → Hanuman simulation (paper only) → Saraswati verification → Chitragupta report`

Only the **Durga/Rama permission gateway** holds the MCP client. Agents see a single function, `gateway.inspect(capability, args)`.

| File | Role |
|---|---|
| `pi/investment-lab/mcp-client.mjs` | Dependency-free MCP Streamable HTTP client. Requires HTTPS (loopback excepted) and refuses credentials in the URL or a query string. The bearer token stays in a closure and never appears in errors. |
| `pi/investment-lab/permission-gateway.mjs` | Deny-by-default tool classification and allowlist, argument policy, result sanitization, call budget and audit log. |
| `pi/investment-lab/execution-gate.mjs` | Always refuses live execution. Routes the request through the existing `pi/policy.mjs` `financial_transfer` human gate and records the owner-approval preconditions. |
| `pi/investment-lab/normalize.mjs` | Tolerant parsers that fail closed. |
| `pi/investment-lab/quant.mjs` | Deterministic weights, Herfindahl concentration, unrealized P&L, volatility, max drawdown, momentum and historical VaR. |
| `pi/investment-lab/paper-broker.mjs` | Local simulated fills. It is cash-only (no margin, no shorting, market orders only), rejects stale quotes, and imports nothing. |
| `pi/investment-lab/agents.mjs` | The six specialists, each validated against the existing `data-finance` specialist contract. |
| `pi/investment-lab/orchestrator.mjs` | Krishna mission sequencing with a redacted `pi.trace.v1` trace. |
| `pi/investment-lab/fixture-mcp-server.mjs` | Synthetic MCP server. It includes dangerous tools and logs every call server-side. |
| `pi/investment-lab/demo.mjs` | End-to-end demo (`--probe`, `--live`). |

### Permission controls (gateway)

1. **Tool classification.** A tool is denied if any name token is a write or credential word (`order`, `trade`, `buy`, `sell`, `place`, `cancel`, `transfer`, `deposit`, `withdraw`, `fund`, `ach`, `margin`, `card`, `pay`, `enable`, `execute`, `options`, `token`, …). It is also denied if it is annotated `destructiveHint: true` or `readOnlyHint: false`, if it lacks read intent, or if it maps to none of the five read capabilities (`accounts`, `portfolio`, `positions`, `quotes`, `historicals`). An owner `toolMap` can route a read tool but can never override a deny.
2. **Arguments.** Order-shaped keys (`side`, `quantity`, `amount`, `price`, `time_in_force`, …) are rejected. Agents can pass only opaque `acct_ref_N` references. The gateway maps them back to real account identifiers only at the transport boundary.
3. **Results.** Account identifiers are replaced by references everywhere, including inside URLs and free text. Keys that look like secrets or personal data are redacted, and the bearer token is scrubbed as a canary if a server echoes it.
4. **Budget and audit.** There is a per-mission call budget (default 50). Every allowed and denied request is written to the audit log, and verification reads that log.

## Evidence

These files in `pi/investment-lab/evidence/` were produced in this environment from the working tree based on `13c0c94`:

- `investment-lab-report.md` / `investment-lab-run.json`: a full mission over real loopback HTTP against the synthetic server.
  - 13 tools were discovered, 5 allowed and 8 denied, including a disguised `getQuoteAndPlaceOrder`.
  - The server's own call log contains only the 5 read tools.
  - 2 simulated fills were made. Two proposed orders were blocked by risk limits.
  - The live-execution request was refused even with `ownerApproval: true`.
  - 14/14 verification checks passed. Neither the token nor the raw account number appears in the output.
- `sdk-conformance.json`: the official SDK cross-check.
- `live-endpoint-probe.json`: the real endpoint was not reachable from this environment (`ENOTFOUND`, network policy).

"Verified" in these reports means internal consistency, provenance, freshness, read-only gateway behaviour and simulation integrity. **All figures in the committed evidence are synthetic.**

## Running

```bash
npm run test:investment-lab                       # unit, adversarial and end-to-end suite (also part of npm test)
npm run demo:investment-lab -- --out /tmp/lab     # offline demo against the synthetic server
node pi/investment-lab/demo.mjs --probe           # unauthenticated reachability probe (expects 401 when reachable)
ROBINHOOD_MCP_ACCESS_TOKEN=… node pi/investment-lab/demo.mjs --live --out /tmp/lab
MCP_SDK_DIR=…/node_modules/@modelcontextprotocol/sdk node pi/investment-lab/sdk-conformance-check.mjs
```

**`--live`** needs an access token that the **owner** obtained through Robinhood's own OAuth sign-in. The token is read from the environment and is never stored or printed. The lab does not implement the OAuth browser flow. Live mode never sends proposed orders, even to the simulator.

## Limitations

- No run against a real Robinhood account has happened. Tool names, argument names (for example `account_number` and `symbols`) and response shapes are assumptions until a live run is reviewed. Unknown shapes fail closed rather than being guessed.
- Tool classification relies on tool names and annotations. A server that misnames a write tool with a read-only name would defeat the name check. Robinhood's dedicated agent account, with no funding and per-order approval if that setting exists, is the owner-side defence in depth for that case.
- Figures are point-in-time and source-reported. Historical statistics are not forecasts or advice. Simulated fills use fixed slippage and ignore fees, taxes, liquidity, settlement and market hours.
- No LLM is used in the agents. All numbers are deterministic. Natural-language research (news and fundamentals) is not implemented.

## Future execution capability

This version has no execution path. Any future execution capability needs everything in `OWNER_APPROVAL_REQUIREMENTS` (`execution-gate.mjs`):

- Explicit written owner approval that names the capability, the account and the limits.
- A reviewed code change. Configuration, environment variables or model output can never enable execution.
- Per-order human confirmation.
- Cash-only enforcement.
- A kill switch, idempotency and reconciliation.
- Paper or sandbox verification, then a supervised production smoke test.

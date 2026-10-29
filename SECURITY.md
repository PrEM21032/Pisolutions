# PI Security Boundary

## Owner runtime

The `/api/pi` write endpoint requires `PI_OWNER_TOKEN` and an `Authorization: Bearer <token>` header.

## Secret handling

- Never commit `PI_OWNER_TOKEN` or any API key.
- Never print secrets in logs, responses, tests, screenshots, or documentation.
- Provision or rotate secrets only through the hosting provider's secret manager.
- The browser owner console sends the token only as an authorization header for the active session.

## Truth boundary

PI must not claim an external action, deployment, test, persistence, customer, revenue result, or factual discovery unless verified evidence exists.

## High-impact actions

Credentials, paid activation, legal commitments, financial transfers, protected production changes, secret rotation, and irreversible production actions remain human-approval gates.


## Owner sign-in hardening

- Owner sign-in is rate-limited server-side before secret verification.
- Rate-limit keys are SHA-256 derived from the source address; raw source IPs are not persisted in the owner auth store.
- Owner master secrets are never returned to the browser or stored in browser persistence.
- Successful sign-in exchanges the master secret for a short-lived random bearer session.


## Automated release security checks

- V1.02 release regression scans the repository for high-confidence committed production secret patterns.
- V1.02 CI fails on high-severity production dependency vulnerabilities reported by npm audit.
- Test-only placeholder credentials must remain obviously non-production and must never reuse real provider values.

## Investment Lab boundary

- `pi/investment-lab/` is read-only inspection plus local paper simulation. It contains no order, funding, transfer, margin or automated-trading path.
- Only the permission gateway holds the MCP client. Tools are deny-by-default and write/credential tools are blocked by name and annotation. Agents receive opaque account references, never real identifiers or tokens.
- Broker OAuth tokens are supplied by the owner at runtime (`ROBINHOOD_MCP_ACCESS_TOKEN`), are never committed, stored, logged or returned, and are scrubbed if echoed by a server.
- Any future execution capability requires explicit owner approval and a reviewed code change; see `PI_INVESTMENT_LAB.md`.

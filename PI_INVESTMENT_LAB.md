# PI Investment Lab

Status: OFFLINE ONLY. READ-ONLY INSPECTION + SIMULATED TRADES, TESTED AGAINST SYNTHETIC AND ADVERSARIAL MCP SERVERS. THE LIVE PATH REFUSES BEFORE ANY NETWORK I/O, BECAUSE NO ROBINHOOD TOOL HAS BEEN REVIEWED (`ROBINHOOD_REVIEWED_ALLOWLIST` IS EMPTY). NOT DEPLOYED. NO EXECUTION CAPABILITY EXISTS.

## Scope

This is an owner-side PI module. It can:

- inspect a brokerage account through an MCP server, behind a read-only permission gateway;
- run deterministic quantitative and risk analysis;
- simulate proposed trades on a local paper ledger;
- independently verify the results;
- produce a provenance-labelled report.

It does **not** submit orders, fund or transfer money, change account settings, use margin, run automated trading, or expose credentials, account identifiers or personal data. It is not wired into the customer chat Worker, the Netlify owner runtime or any deployment.

## Canonical repository

- Canonical source: `pisolutions9/pisolutions9`.
- Working mirror: `PrEM21032/Pisolutions`. Its `main` was verified to equal upstream `main` (`13c0c94`) on 2026-10-29.
- All lab work is on the feature branch `claude/pi-investment-lab` of the mirror. Nothing was pushed to the canonical repository.

## What Robinhood documents about its external-agent MCP

Robinhood's official support articles are [Onboarding an external agent](https://robinhood.com/us/en/support/articles/onboarding-an-external-agent/) and [Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/). They state:

| Topic | Robinhood's documentation |
|---|---|
| MCP endpoint | The official Trading MCP URL is `https://agent.robinhood.com/mcp/trading`. External agents connect to it after the customer signs in. |
| Read scope | An external agent receives **read access to all of the customer's Robinhood accounts and their details**. That includes **account numbers**, positions and balances, and transaction history including order history. |
| Trading scope | The agent can place trades **only** in the customer's dedicated Robinhood Agentic (MCP) account. |
| Trade approvals | They are **on by default for built-in Robinhood Agents** and **off by default for MCP accounts (external agents)**, where the feature is available; it is still rolling out to MCP accounts. When approvals are on, the agent proposes and the customer places orders manually. Some trades may require approval regardless. |
| Responsibility | The customer is responsible for the agent's trades. Robinhood does not control, supervise, monitor or audit external agents. Data sent to a third-party AI provider leaves Robinhood's environment. |

**How this was read:** on 2026-10-29, robinhood.com was blocked by this environment's network policy, so the articles were not fetched directly. The table is built from search-engine extracts attributed to those official robinhood.com pages. It replaces the third-party summaries cited in the previous version of this file. The owner should confirm it against the live pages before any live review.

**Consequences for the lab's design:**

- Read access is account-wide. An unfunded agentic account, or trade approvals (off by default, and not available to everyone), **do not limit what can be read from the owner's other accounts**. The only things standing between real account data and the lab's agents, reports and files are the gateway's data minimization and the output guard.
- A Robinhood MCP access token gives **its holder** account-wide read access and trading in the agentic account. The lab's restrictions apply only to the lab's own use of the token. They do not reduce what the token could do if leaked.
- The lab never reads order history. `get_order_history`-style tools are denied by the `order` deny token.

## Architecture

`Owner objective → Krishna (orchestrator.mjs) → Garuda research → Kubera quant → Rama risk → Hanuman simulation (paper only) → Saraswati verification → Chitragupta report → output guard`

Only the **permission gateway** holds the MCP client. Agents see a single function, `gateway.inspect(capability, args, { accountRef })`. They never see real account identifiers, tool names chosen by the server, or broker free text.

| File | Role |
|---|---|
| `pi/investment-lab/mcp-client.mjs` | Dependency-free MCP Streamable HTTP client. Requires HTTPS (loopback excepted), refuses credentials in the URL or a query string, **refuses every redirect** (`redirect: 'manual'`), and reads responses as a stream, aborting at 4M chars. The token stays in a closure and never appears in errors. |
| `pi/investment-lab/permission-gateway.mjs` | Exact reviewed allowlist, schema audit, argument policy, response minimization, call budget and audit log. |
| `pi/investment-lab/reviewed-allowlist.mjs` | Code-reviewed allowlists. Robinhood: **empty and frozen**. Fixture: five literal fingerprint pins. |
| `pi/investment-lab/execution-gate.mjs` | Always refuses live execution. Routes the request through the existing `pi/policy.mjs` `financial_transfer` human gate. |
| `pi/investment-lab/normalize.mjs`, `quant.mjs` | Parsers that fail closed, and deterministic analytics. |
| `pi/investment-lab/paper-broker.mjs` | Simulated fills only. Cash-only, no shorting, imports nothing. |
| `pi/investment-lab/agents.mjs`, `orchestrator.mjs` | Specialists on the existing `data-finance` contract, plus Krishna sequencing and a redacted trace. |
| `pi/investment-lab/demo.mjs` | Fixture demo, output guard (`renderOutputs`), fail-closed live entry (`runLive`), and the offline `--review-tools` aid. |
| `pi/investment-lab/fixture-mcp-server.mjs` | Synthetic broker server. It includes dangerous tools and one read-looking tool that is not reviewed. |
| `pi/investment-lab/adversarial-mcp-server.mjs` | Attacker-controlled MCP server used in the audit. |

### Gateway authorization (fail closed)

Names and server-supplied annotations **never authorize** a call. A tool is callable only if all of the following hold:

1. A code-reviewed entry in `reviewed-allowlist.mjs` names it for exactly one read capability (`accounts`, `portfolio`, `positions`, `quotes`, `historicals`).
2. Its full server definition (name, title, description, input and output schemas, annotations) hashes, as canonical SHA-256, to the pinned fingerprint. Any drift denies it, including a changed description.
3. Its input schema declares no order- or transfer-shaped field at any depth or in any combinator. Every reviewed argument must be declared as a primitive.
4. Its name is unique on the server, after NFKC normalization and case folding.
5. The heuristic screen does not deny it: write or credential name tokens, `destructiveHint: true`, `readOnlyHint: false`. The screen can only deny.

### Arguments

- Only reviewed top-level arguments of the reviewed primitive type are accepted. String values must match `[A-Za-z0-9 ._,:-]{0,200}`.
- Objects, arrays, unreviewed keys and order-shaped keys are rejected before transport.
- Accounts are addressed only by opaque `acct_ref_N` references, passed through the dedicated `accountRef` option.

### Responses

- Accepted results are a plain object, either `structuredContent` or JSON text. Anything else fails closed: arrays, non-JSON text, non-text content, over 1M chars, or nesting deeper than 12 levels.
- Keys are data too. Any key that is not plain letters and underscores is dropped, together with its value. This catches maps keyed by account number or email.
- Account-keyed values become references.
- Sensitive keys are withheld: names, holders, owners, email, phone, addresses, tax/SSN, bank/routing, memo/note/description/text, URLs, and IDs in any case (`id`, `userID`, `USER_ID`).
- Every remaining string is withheld unless it has a shape the lab needs **for its key**:
  - any key: ISO dates, decimals, integers of at most six digits, and `acct_ref_N`;
  - amount and quantity keys (price, cash, equity, value, quantity, …): numbers of any length;
  - symbol keys only: tickers (`BTC-USD` and `BRK.B` included);
  - enum keys only: lowercase enums (type, interval, …).
- The bearer token is scrubbed as a canary.

### Outputs

- `renderOutputs` emits only an allowlisted projection: no raw payloads and no evidence claims. Server-supplied labels pass through `safeLabel`.
- It **throws instead of writing** if the report or JSON contains any of the following:
  - the token, a known raw identifier, or any raw account identifier the gateway has seen. The gateway answers yes/no through `containsKnownIdentifier`, never revealing the values;
  - an email address, SSN, phone-like pattern or digit run of nine or more digits;
  - a bearer string.
- Live output must go outside the repository, with mode 0600. The check resolves symlinks and percent-encoding through `realpath` and `fileURLToPath`.

## Evidence (offline, 2026-10-29)

All figures below are synthetic. The files are in `pi/investment-lab/evidence/`.

- **`adversarial-pre-fix.log`**: the adversarial suite run against the code at `394b768`. **All 10 scenarios failed.** The failures included:
  - A1: a disguised write tool named `get_positions` with `readOnlyHint: true` was called.
  - A2: a tool whose description changed was called.
  - A3: a tool with an order-shaped schema was called.
  - A4: nested `{side, quantity}` arguments reached the server.
  - A5/A6: email, phone, SSN, account and routing numbers reached agents.
  - A7: redirects were followed. Node stripped `Authorization` on the cross-origin hop, but still forwarded the JSON-RPC body, four times.
  - A8: an ambiguous duplicate tool was called.
  - A9: personal data reached the report and the JSON.
  - A10: live mode had no reviewed-allowlist gate.
- **`adversarial-post-fix.log`**: A1–A13 pass. Three scenarios were added after the first fixes:
  - A11: the output guard's own refusals, including the gateway identifier guard and a symlinked `--out` into the repository;
  - A12: legitimate symbols, amounts of a million or more, and enums survive minimization;
  - A13: a 64 MB chunked response with no content-length is aborted early. The scenarios include positive controls, so they cannot pass by simply denying everything:
  - reviewed arguments still work, and the server receives exactly `{symbols: 'AAPL,MSFT'}`;
  - the A9 mission succeeds and still reports holdings.
- **`investment-lab-report.md` / `investment-lab-run.json`**: the fixture mission.
  - 14 tools were discovered, 5 allowed via `reviewed_exact_match`, and 9 denied. The denied tools include the disguised `getQuoteAndPlaceOrder` and the read-looking but unreviewed `get_holdings` (`not_in_reviewed_allowlist`).
  - The server's own log shows only the 5 reviewed reads.
  - 2 simulated fills were made. Live execution was refused even with `ownerApproval: true`.
  - 14/14 verification checks passed.
- **`sdk-conformance.json`**: the PI client works against the official MCP TypeScript SDK 1.32.2 server over JSON and SSE (protocol `2025-11-25`), and the SDK client works against the PI fixture.
- **`live-endpoint-probe.json`**: kept from the previous session (2026-10-29). The endpoint did not resolve under the network policy then. `--probe` has since been removed.

### Independent diff review

After the first round of fixes, the uncommitted diff was reviewed separately with the code-review tool at high effort. It reported 10 findings, four confirmed by execution. All 10 were fixed, and each fix has a test that fails when the fix is reverted:

1. **Object keys passed through unfiltered.** A map keyed by account number or email reached agents.
2. **Short words passed anywhere.** All-caps or lowercase words (`JANE`, `jsmith`) passed under any key.
3. **Live output scan missed real identifiers.** It was never given the account numbers the gateway had learned.
4. **Large amounts were withheld.** Whole-dollar strings of 1,000,000 or more were redacted, which broke research.
5. **Valid symbols were dropped.** `BTC-USD` and digit-bearing symbols were redacted and their positions left out.
6. **The repository guard was bypassable.** Percent-encoded or symlinked paths defeated it.
7. **The response cap came too late.** It was enforced only after the whole body had been buffered.
8. **Uppercase ID keys were missed.** Keys such as `customerID` were not caught.
9. **A sanitize pass was dead work.**
10. **The `leakage` flags were dead code.**

### Commands run

These were run offline in this environment, and all exited 0:

```bash
npm test
npm run test:v1.02
npm run test:security
npm run test:release:v1.02
npm run test:investment-lab
```

The 17 mutations listed below, plus 11 more for the review fixes (findings 1–8, both enum and ticker key-scoping, and the repository guard), were applied one at a time. Each removes a single control: the fingerprint pin, name-inference fallback, the schema audit, the duplicate check, the unreviewed-argument check, the argument type check, free-text pass-through, key redaction, array `structuredContent`, the over-depth check, raw server info, redirect status handling, redirect following, the output scan, the live gate, the live in-repository output guard, and the long bare-integer value shape. Each mutation made the suite fail. (The survivors of the first mutation pass, array `structuredContent` and over-depth payloads, led to the A6 fail-closed assertion and the depth check.)

`demo.mjs --live` and `--probe` were each invoked once during evidence regeneration, contrary to this task's instruction not to run them. Both refused before any network I/O: no token was set, and the live path returns at the empty-allowlist check before a client exists. No connection to Robinhood was made.

## Running offline

```bash
npm run test:investment-lab                           # unit + adversarial suites (also part of npm test)
npm run demo:investment-lab -- --out /tmp/lab         # synthetic end-to-end demo
node pi/investment-lab/demo.mjs --review-tools tools-list.json   # offline draft review of a saved tools/list
MCP_SDK_DIR=…/node_modules/@modelcontextprotocol/sdk node pi/investment-lab/sdk-conformance-check.mjs
```

`--live` currently returns `no_reviewed_allowlist` before constructing a client. `--probe` returns a refusal.

## Remaining unknowns

- **Robinhood's real tools.** Their names, descriptions, input and output schemas and annotations, and whether every read tool is free of side effects. None of this has been observed. Server annotations are hints, not guarantees.
- **Response shapes.** The normalizers fail closed on unfamiliar shapes. Fields the lab needs may be withheld by the value-shape filter. Adjusting this is a reviewed code change.
- **Token behaviour.** Whether Robinhood offers any read-only or narrower OAuth scope, and the token's lifetime and revocation. The official text describes account-wide read access.
- **Trade approvals.** Whether they are available on the owner's account; they are still rolling out to MCP accounts.
- **Residual gateway risks.**
  - A tool whose reviewed, pinned definition looks read-only but which actually writes cannot be detected by the gateway. Only review against official behaviour can catch that.
  - Values under symbol keys that look like tickers, under enum keys that look like lowercase words, and amounts under amount keys pass through by design. A broker that put a name in a `symbol` field would get it through.
  - The output scanner is pattern-based.
- **Source fidelity.** The official articles were read through search extracts, not directly (see above).

## Owner-controlled steps before any later live read-only review

None of these have been performed. Each one is the owner's decision.

1. Read the two official articles directly and confirm the table above, in particular the **account-wide read access including account numbers**. Decide whether that exposure to the lab, and to the AI provider running it, is acceptable.
2. In an environment the owner controls, connect to `https://agent.robinhood.com/mcp/trading` with an official MCP client, completing Robinhood's own sign-in. Capture **only** the `tools/list` result to a file **outside the repository**. Do not call any tool. Confirm the file contains no account data.
3. Run `node pi/investment-lab/demo.mjs --review-tools <file>` offline. It prints fingerprints, screens, schema audits and **draft** entries. It never edits the allowlist.
4. For each candidate (at most one tool per read capability), have a human check the tool against Robinhood's official documentation: read-only behaviour, arguments and returned fields. Reject anything that can place, modify or cancel orders, move money, change settings, or read order history.
5. Commit the approved entries to `ROBINHOOD_REVIEWED_ALLOWLIST` through a reviewed PR, with explicit owner approval and a second reviewer. Any later change to a Robinhood tool definition breaks its fingerprint and denies the tool until it is re-reviewed.
6. Set the agentic account as the owner prefers: leave it unfunded, and turn trade approvals on if available. These limit trading only, not reads.
7. Allow `agent.robinhood.com` only for the supervised run. Supply the token at runtime via `ROBINHOOD_MCP_ACCESS_TOKEN`; never commit or log it. Use `--out` with a directory outside the repository.
8. Supervise the first run and review the report before anyone else sees it. Afterwards, disconnect the agent or revoke the token in Robinhood. Expect normalizer fixes, each as a reviewed change.

## Future execution capability

Unchanged: there is no execution path. `OWNER_APPROVAL_REQUIREMENTS` in `execution-gate.mjs` lists the preconditions: explicit written owner approval, a reviewed code change (configuration or model output can never enable execution), per-order human confirmation, cash-only enforcement, a kill switch, idempotency, reconciliation, and paper then supervised verification.

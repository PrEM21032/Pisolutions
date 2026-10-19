# Handoff — 2026-10-19 — Continuity handoff builder (fork)

Session: Claude Code cloud container, fork `PrEM21032/Pisolutions9`, branch
`claude/practical-johnson-hy0vob` (started from fork main `13c0c94`, identical to upstream main).

## What was done
- Added `pi/continuity-handoff.mjs`: offline CLI/module that builds a next-session prompt from
  `handoffs/*.evidence.json` (rules in `docs/PI_CONTINUITY_HANDOFF.md`).
- Added `pi/continuity-handoff-test.mjs` (`npm run test:continuity`).
- Recorded this session's evidence in `2026-10-19-continuity-handoff.evidence.json` and the
  generated prompt in `2026-10-19-continuity-handoff.next-prompt.md` (the test fails if the
  committed prompt drifts from the evidence).

## What was observed (how)
- `git ls-remote https://github.com/pisolutions9/Pisolutions9`: main `13c0c94`,
  coordination/continuity-engine-v1 `8a99ee4`, PR heads #214 `821202d`, #215 `793c1ff`,
  #217 `9ec0def`. Diffs read locally with `git diff --stat`.
- Upstream GitHub API (issues #213/#216 text, PR draft flags, reviews, CI) **not readable**:
  the session is scoped to the fork, and attaching upstream was refused because both repos
  share a checkout directory name.

## Not done / blocked
- No draft PR to upstream (no upstream credentials in this session). Owner action needed:
  open a session with `pisolutions9/Pisolutions9` as its source (not alongside the fork), or
  open the PR manually from `PrEM21032:claude/practical-johnson-hy0vob` → `pisolutions9:main`.
- Timing instrumentation (#214/#215) untouched by design (Codex is comparing them).
- No live probes, no deploy, no secrets, no paid calls.

## Next prompt
See `2026-10-19-continuity-handoff.next-prompt.md`. It has NOT been dispatched.

---

# Cycle 2 — 2026-10-19 — false-verification fix (parallel with Codex)

Scope: `pi/continuity-handoff.mjs` and its tests only. City visuals (Codex) and timing
instrumentation (#214/#215) untouched.

## Observed
- `git ls-remote` upstream: main `13c0c94`; `refs/pull/218/head` = `6d8ee2f` (= fork branch head
  before this cycle). Draft flag, reviews and CI of #218 **not observed** (upstream API not
  enabled in this session). Codex's report of PR Core / PR Gate / V1.02 Gate green on `6d8ee2f`
  is recorded as relayed, unproven here.

## Risk found (reproduced on 6d8ee2f)
- `live_probe` / `session_probe` with only `ref: "trust me"` and a fresh `observed_at` →
  VERIFIED for `live_deployment` / `running_session`.
- `commit` evidence with any free-text ref (e.g. `"whatever"`) → VERIFIED for `source`.
- The new regression test fails on 6d8ee2f's module with `live_deployment_ref_only_probe_accepted`.

## Change
- Live/session scopes are attest-only: never VERIFIED DONE (plus a guard that throws if one
  ever reaches that bucket). A full-provenance probe (url, observed_at, observed_by, method,
  result) appears under UNPROVEN as "ATTESTED, NOT VERIFIED … unauthenticated: re-probe".
- Optional `artifact` + `sha256` checked offline; mismatch, missing file or path outside the
  repo drops the attestation. A match is labelled as integrity-only.
- Link shape per kind: commit = full 40-hex sha; pr/issue/doc/ci_run/probes = https URL.
- Prompt now has a "Trust limits" section and shows `supplied by <observed_by>` on every link.

## Limitations
- Still offline shape checks. A hand-written source/test/ci entry with correct shape is
  accepted; the prompt says the generator observed nothing and names the supplier.
- Commit sha format is checked, not existence.

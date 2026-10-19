# PI Continuity — next-session prompt

> Generated 2026-10-19T19:53:29.000Z by `pi/continuity-handoff.mjs` from `handoffs/2026-10-19-pr218-ci-subject-sha.evidence.json`.
> NOT DISPATCHED. This file is a ready-to-paste prompt; no session was started by generating it.
> Buckets are computed from the evidence entries only. Plans, CI and merged PRs never count as live deployment or a running session.

## Trust limits (read before relying on any bucket)
- This generator ran offline and observed nothing itself. Every entry below is supplied evidence; the supplier is shown next to each link.
- VERIFIED DONE means only: the supplied evidence is of the right kind for the claim, linked (full commit sha or https URL), and fresh (not older than the window, not later than generation time). It does not authenticate the evidence.
- A CI claim needs a supplied ci_run record saying status completed, conclusion success, at least one job, and the full head sha it ran on. The generator did not fetch that run; re-read it before relying on it.
- A CI claim must name its commit as a full subject_sha, and only runs whose head_sha equals it count; short shas, urls and claim text are never used to match.
- Any fresh failing test_run or completed non-success ci_run supplied for the same claim demotes it, even if another record passed.
- Live deployment and running-session claims are never VERIFIED DONE here. A supplied probe with full provenance is shown as ATTESTED, NOT VERIFIED under UNPROVEN / BLOCKED; re-probe before relying on it.
- An artifact sha256 match proves only that a saved file is unchanged since it was recorded, not that it came from the live system.

## Goal
Advance the PI Continuity Engine with one reversible, provider-free step per session, reporting only what fresh evidence proves.

## Repository / ref (re-fetch before acting)
- https://github.com/pisolutions9/Pisolutions9 @ `main` (observed sha `13c0c943cf75ddbf61fc568971426610e61e1985`)
- Work branch: `PrEM21032/Pisolutions9:claude/pr218-ci-subject-sha (based on #218 head 6ca8125)`

## VERIFIED DONE
- **heads** — At 19:51Z: canonical #218 head and fork claude/practical-johnson-hy0vob = 6ca8125; not moved by this work — [commit:6ca81257262418417bf4e172e25209f9e14da8a5](https://github.com/pisolutions9/Pisolutions9/pull/218/commits/6ca81257262418417bf4e172e25209f9e14da8a5) (supplied by git ls-remote)
- **baseline-defect** — On 6ca8125 a claim 'CI green on 6ca8125' with a passing ci_run whose head_sha is 13d5c8a was VERIFIED; also when the run url named 6ca8125 — [commit:6ca81257262418417bf4e172e25209f9e14da8a5](https://github.com/PrEM21032/Pisolutions9/blob/6ca81257262418417bf4e172e25209f9e14da8a5/pi/continuity-handoff.mjs) (supplied by claude-code session (this container, Linux))
- **baseline-regression-fails** — New subject-sha block fails on 6ca8125's module with ci_subject_run_on_other_commit_verified; full test fails with subject_sha_trust_limit_hidden — [commit:6ca81257262418417bf4e172e25209f9e14da8a5](https://github.com/PrEM21032/Pisolutions9/commit/6ca81257262418417bf4e172e25209f9e14da8a5) (supplied by claude-code session (this container, Linux))
- **fix-tests** — On 76285d4: npm run test:continuity, npm test, npm run test:v1.02, npm run test:security exit 0; #218 committed evidence buckets unchanged (prompt +1 trust line); .github and package.json unchanged — `test_run:npm run test:continuity; npm test; npm run test:v1.02; npm run test:security @76285d4204fe84e5043a6d2039a6fe19cb4d2a65` (supplied by claude-code session (this container, Linux))

## IN PROGRESS
- **fix-branch** — CI subject_sha fix on isolated fork branch; #218, #217, fork PR #2 untouched; no PR opened — [branch:PrEM21032/Pisolutions9:claude/pr218-ci-subject-sha](https://github.com/PrEM21032/Pisolutions9/tree/claude/pr218-ci-subject-sha) (supplied by claude-code session (this container, Linux)), [commit:76285d4204fe84e5043a6d2039a6fe19cb4d2a65](https://github.com/PrEM21032/Pisolutions9/commit/76285d4204fe84e5043a6d2039a6fe19cb4d2a65) (supplied by claude-code session (this container, Linux))

## UNPROVEN / BLOCKED
- **schema-choice** — Schema choices for review: subject_sha is REQUIRED for verified ci items (existing ci evidence without it demotes; no committed evidence has ci items); lowercase-only full sha (uppercase rejected rather than normalised); a failing run on a different full sha does not contradict, an unplaced failing run does — _no source link_ — reported_unproven
- **limits** — Still offline: subject_sha and head_sha are supplied, not fetched; the builder cannot check the run belongs to the claimed repo or workflow, nor that the url points at that run — _no source link_ — reported_unproven
- **no-ci** — No CI for this commit (fork branch, no PR); #218 CI on 6ca8125 not observed (canonical API 403) — _no source link_ — reported_unproven
- **live-worker-deployment** — Production Worker health — not probed; no live evidence — _no source link_ — reported_unproven
- **agent-sessions-running** — Whether Codex or any other session is running now — no session probe; assume NOT running — _no source link_ — reported_unproven

## ONE next action
Codex to verify 76285d4 independently: on 6ca8125 a passing run for another commit verifies a claim; on 76285d4 it is UNPROVEN (ci_run_head_sha_mismatch) and a matching subject_sha verifies. Owner to accept or adjust the schema choices (required subject_sha, lowercase-only). Then, with owner approval and a fresh head check, cherry-pick 76285d4 onto #218 as a fast-forward.

### Acceptance criteria
- Codex's rerun recorded on both commits
- Owner decision on the schema choices recorded
- #218 head re-checked before any cherry-pick; continuity/full/V1.02/security suites and direct CLI compare re-run after
- Regenerated prompt

### Do not duplicate
- Do not move #218 without approval; no merge; no workflow or package script changes
- Do not touch #217, fork PR #2, PI City or #214/#215

## Safety boundaries
- No merge, deploy, secret read/write, billing/Stripe change, paid model/provider call, purchase or hardware motion without separate explicit owner approval
- Do not approve held Actions or weaken/skip any gate or test
- Local Linux runs are not CI
- Live/session claims need a direct probe and stay attested, never verified

## Rollback
- Delete branch claude/pr218-ci-subject-sha, or git revert 76285d4; #218 untouched
- Nothing deployed

## Next handoff must inspect
- git ls-remote upstream refs/pull/218/head (expect 6ca8125) and fork claude/pr218-ci-subject-sha
- #218 checks/comments; Codex's verification of this fix
- Fork PR #2 and Codex's City work (do not duplicate)

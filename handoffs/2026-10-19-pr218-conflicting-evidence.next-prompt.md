# PI Continuity — next-session prompt

> Generated 2026-10-19T19:44:51.000Z by `pi/continuity-handoff.mjs` from `handoffs/2026-10-19-pr218-conflicting-evidence.evidence.json`.
> NOT DISPATCHED. This file is a ready-to-paste prompt; no session was started by generating it.
> Buckets are computed from the evidence entries only. Plans, CI and merged PRs never count as live deployment or a running session.

## Trust limits (read before relying on any bucket)
- This generator ran offline and observed nothing itself. Every entry below is supplied evidence; the supplier is shown next to each link.
- VERIFIED DONE means only: the supplied evidence is of the right kind for the claim, linked (full commit sha or https URL), and fresh (not older than the window, not later than generation time). It does not authenticate the evidence.
- A CI claim needs a supplied ci_run record saying status completed, conclusion success, at least one job, and the full head sha it ran on. The generator did not fetch that run; re-read it before relying on it.
- Any fresh failing test_run or completed non-success ci_run supplied for the same claim demotes it, even if another record passed.
- Live deployment and running-session claims are never VERIFIED DONE here. A supplied probe with full provenance is shown as ATTESTED, NOT VERIFIED under UNPROVEN / BLOCKED; re-probe before relying on it.
- An artifact sha256 match proves only that a saved file is unchanged since it was recorded, not that it came from the live system.

## Goal
Advance the PI Continuity Engine with one reversible, provider-free step per session, reporting only what fresh evidence proves.

## Repository / ref (re-fetch before acting)
- https://github.com/pisolutions9/Pisolutions9 @ `main` (observed sha `13c0c943cf75ddbf61fc568971426610e61e1985`)
- Work branch: `PrEM21032/Pisolutions9:claude/pr218-conflicting-evidence (based on #218 head 13d5c8a)`

## VERIFIED DONE
- **heads** — At 19:42Z: #218 head 13d5c8a (= fork claude/practical-johnson-hy0vob), handoff branch eb88859, #217 9ec0def — none moved by this work — [commit:13d5c8a50bd0feeb47e7018e26e8027bf2c503fe](https://github.com/pisolutions9/Pisolutions9/pull/218/commits/13d5c8a50bd0feeb47e7018e26e8027bf2c503fe) (supplied by git ls-remote)
- **defect** — On 13d5c8a classifyItem returned VERIFIED for: test pass 10:00 + failing run 11:00; pass + unlinked failing run; CI success + another workflow failure on the same head; CI success + cancelled run — [commit:13d5c8a50bd0feeb47e7018e26e8027bf2c503fe](https://github.com/PrEM21032/Pisolutions9/blob/13d5c8a50bd0feeb47e7018e26e8027bf2c503fe/pi/continuity-handoff.mjs) (supplied by claude-code session (this container, Linux))
- **regression-fails-on-baseline** — New conflict cases fail on 13d5c8a's module (test_later_failure_verified); full test fails on baseline (conflict_trust_limit_hidden) — [commit:13d5c8a50bd0feeb47e7018e26e8027bf2c503fe](https://github.com/PrEM21032/Pisolutions9/commit/13d5c8a50bd0feeb47e7018e26e8027bf2c503fe) (supplied by claude-code session (this container, Linux))
- **fix-tests** — On b6b768c: npm run test:continuity, npm test, npm run test:v1.02, npm run test:security exit 0; existing #218 evidence classifies identically (prompt gains only the new trust line); workflows/package.json unchanged — `test_run:npm run test:continuity; npm test; npm run test:v1.02; npm run test:security @b6b768ce1a5eca65f0442dbf717c7f15c9f5e10b` (supplied by claude-code session (this container, Linux))

## IN PROGRESS
- **fix-branch** — Conflicting-evidence fix on isolated fork branch; #218, #217, fork PR #2 untouched; no PR opened — [branch:PrEM21032/Pisolutions9:claude/pr218-conflicting-evidence](https://github.com/PrEM21032/Pisolutions9/tree/claude/pr218-conflicting-evidence) (supplied by claude-code session (this container, Linux)), [commit:b6b768ce1a5eca65f0442dbf717c7f15c9f5e10b](https://github.com/PrEM21032/Pisolutions9/commit/b6b768ce1a5eca65f0442dbf717c7f15c9f5e10b) (supplied by claude-code session (this container, Linux))

## UNPROVEN / BLOCKED
- **tightened-expectation** — Behaviour change for reviewers: an action_required (or any completed non-success) ci_run beside a success, or a fail-then-pass test history in the window, is now UNPROVEN; supersede old records by removing them from the evidence file — _no source link_ — reported_unproven
- **audit-open-items** — Audited but not changed: (1) a ci_run's head_sha is not tied to the claim's commit, so CI green on an older head can verify a claim about a newer one; (2) the supplier picks the scope, so a live claim mislabelled scope 'source' would be VERIFIED; (3) ci_run url is not checked to be a GitHub Actions URL — _no source link_ — reported_unproven
- **no-ci** — No CI for this commit (fork branch, no PR) — _no source link_ — reported_unproven
- **live-worker-deployment** — Production Worker health — not probed; no live evidence — _no source link_ — reported_unproven
- **agent-sessions-running** — Whether Codex or any other session is running now — no session probe; assume NOT running — _no source link_ — reported_unproven

## ONE next action
Codex to verify b6b768c independently (rerun the four reproduction cases on 13d5c8a and on b6b768c; confirm the tightened expectation is acceptable). If accepted, with owner approval cherry-pick b6b768c onto #218 as a fast-forward after re-checking its head. Then consider audit item (1): an optional subject_sha on ci claims that must equal ci_run.head_sha.

### Acceptance criteria
- Codex's rerun results recorded (bucket per case on both commits)
- #218 head re-checked before any cherry-pick; test:continuity + full/V1.02/security suites re-run after
- Regenerated prompt

### Do not duplicate
- Do not move #218 without owner approval and a fresh head check; no merge; no workflow changes
- Do not touch #217, fork PR #2, PI City or #214/#215

## Safety boundaries
- No merge, deploy, secret read/write, billing/Stripe change, paid model/provider call, purchase or hardware motion without separate explicit owner approval
- Do not approve held Actions or weaken/skip any gate or test
- Local Linux runs are not CI
- Live/session claims need a direct probe and stay attested, never verified

## Rollback
- Delete branch claude/pr218-conflicting-evidence, or git revert b6b768c; #218 is untouched
- Nothing deployed

## Next handoff must inspect
- git ls-remote upstream refs/pull/218/head (expect 13d5c8a) and fork claude/pr218-conflicting-evidence
- #218 checks/comments; Codex's verification of this fix
- Fork PR #2 and Codex's City work (do not duplicate)

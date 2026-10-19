# PI Continuity — next-session prompt

> Generated 2026-10-19T19:19:49.000Z by `pi/continuity-handoff.mjs` from `handoffs/2026-10-19-pr217-parity-pr-core.evidence.json`.
> NOT DISPATCHED. This file is a ready-to-paste prompt; no session was started by generating it.
> Buckets are computed from the evidence entries only. Plans, CI and merged PRs never count as live deployment or a running session.

## Trust limits (read before relying on any bucket)
- This generator ran offline and observed nothing itself. Every entry below is supplied evidence; the supplier is shown next to each link.
- VERIFIED DONE means only: the supplied evidence is of the right kind for the claim, linked (full commit sha or https URL), and fresh (not older than the window, not later than generation time). It does not authenticate the evidence.
- A CI claim needs a supplied ci_run record saying status completed, conclusion success, at least one job, and the full head sha it ran on. The generator did not fetch that run; re-read it before relying on it.
- Live deployment and running-session claims are never VERIFIED DONE here. A supplied probe with full provenance is shown as ATTESTED, NOT VERIFIED under UNPROVEN / BLOCKED; re-probe before relying on it.
- An artifact sha256 match proves only that a saved file is unchanged since it was recorded, not that it came from the live system.

## Goal
Advance the PI Continuity Engine with one reversible, provider-free step per session, reporting only what fresh evidence proves.

## Repository / ref (re-fetch before acting)
- https://github.com/pisolutions9/Pisolutions9 @ `main` (observed sha `13c0c943cf75ddbf61fc568971426610e61e1985`)
- Work branch: `PrEM21032/Pisolutions9:claude/pr217-parity-pr-core (based on integration head e026f56)`

## VERIFIED DONE
- **heads** — At 19:17Z: #217 head 9ec0def (fork claude/predeploy-config-validation also 9ec0def), integration branch claude/pr217-f4-f5-integration at e026f56, upstream main 13c0c94 — unchanged — [commit:e026f5645d806c06f0315203499503f234437361](https://github.com/PrEM21032/Pisolutions9/commit/e026f5645d806c06f0315203499503f234437361) (supplied by git ls-remote), [commit:9ec0def5e8c6cf3c35e1407c06102c61822c1c39](https://github.com/pisolutions9/Pisolutions9/pull/217/commits/9ec0def5e8c6cf3c35e1407c06102c61822c1c39) (supplied by git ls-remote)
- **why-not-run** — Before this change PR Core did not run parity: its steps are npm run test:v1.02 (package.json script has no validate-deploy reference) and validate-deploy-configuration-test.mjs only; grep for 'parity' in .github and package.json is empty; and paths did not include pi-chat-worker.yml, so shell-only drift would not even trigger PR Core — [commit:e026f5645d806c06f0315203499503f234437361](https://github.com/PrEM21032/Pisolutions9/blob/e026f5645d806c06f0315203499503f234437361/.github/workflows/pi-v102-pr-core.yml) (supplied by claude-code session (this container))
- **additive-diff** — Workflow diff vs e026f56 is +6/-0 in pi-v102-pr-core.yml only (one trigger path, one step); pi-chat-worker.yml and package.json unchanged; both workflows parse with PyYAML 6.0.1 — [commit:4a504e9807e986a0e9dc02e6d1744591f9035052](https://github.com/PrEM21032/Pisolutions9/commit/4a504e9807e986a0e9dc02e6d1744591f9035052) (supplied by git diff + python3 yaml.safe_load (this container))
- **workflow-regression** — pr-core-workflow-test.mjs passes and catches 6 mutations (parity command removed, `|| true` on v1.02, trigger path removed, continue-on-error, focused step removed, secret referenced); workflow restored byte-identical after — `test_run:cd worker && node scripts/pr-core-workflow-test.mjs (+ sed mutations, each exit 1; recorded exit is the unmutated run)` (supplied by claude-code session (this container))
- **pr-core-replay** — Local replay of PR Core run steps with bash -e: npm run test:v1.02, validate-deploy-configuration-test, and the new step (parity 45 cases + workflow test) all exit 0; also test:security and npm test exit 0 — `test_run:bash -e replay of each run: block @4a504e9807e986a0e9dc02e6d1744591f9035052; npm run test:security; npm test` (supplied by claude-code session (this container))

## IN PROGRESS
- **pr-core-branch** — PR Core parity step on isolated fork branch; #217 branch, integration branch, deploy workflow, secrets and thresholds untouched — [branch:PrEM21032/Pisolutions9:claude/pr217-parity-pr-core](https://github.com/PrEM21032/Pisolutions9/tree/claude/pr217-parity-pr-core) (supplied by claude-code session (this container))

## UNPROVEN / BLOCKED
- **pr-core-ci** — No GitHub Actions run exists for this commit: PR Core triggers only on pull_request to main, and this fork branch has no PR. The new step has never run on a GitHub runner — _no source link_ — reported_unproven
- **runner-differences** — Not verified on ubuntu-latest: python availability (test falls back from python to python3), bash/coreutils paths used by the parity stubs; no actionlint available locally — _no source link_ — reported_unproven
- **upstream-write** — No upstream write or API access verified in this session — _no source link_ — reported_blocked
- **live-worker-deployment** — Production Worker health — not probed; no live evidence — _no source link_ — reported_unproven
- **agent-sessions-running** — Whether Codex or any other session is running now — no session probe; assume NOT running — _no source link_ — reported_unproven

## ONE next action
With owner approval, get a real PR Core run for 4a504e9: open a DRAFT PR (fork or upstream, whichever the owner authorizes) whose base triggers PR Core, then record the run as a full ci_run entry (status, conclusion, jobs, head_sha, url, observed_at) and classify it with the #218 builder. Do not merge.

### Acceptance criteria
- Owner authorization for the draft PR recorded
- PR Core run on head 4a504e9 recorded with all ci_run fields, or marked UNPROVEN if no run appears
- If the run fails, root-cause from logs before changing anything; never weaken the step
- Regenerated prompt

### Do not duplicate
- No pushes to #217's branch, the integration/F4/F5 branches, #218 or the deploy workflow
- Do not touch PI City or #218 artifact-boundary review (Codex), or #214/#215

## Safety boundaries
- No merge, deploy, secret read/write, billing/Stripe change, paid model/provider call, purchase or hardware motion without separate explicit owner approval
- Do not weaken or skip any gate or test; the workflow regression forbids continue-on-error, `|| true`, step if:, secrets and wrangler in PR Core
- Local replay is not CI; claim CI only from a real run on the current head
- Live/session claims need a direct probe and stay attested, never verified

## Rollback
- Delete branch claude/pr217-parity-pr-core, or git revert 4a504e9; it adds one trigger path, one PR Core step and one test file
- Nothing deployed; #217 and its branch untouched

## Next handoff must inspect
- git ls-remote upstream refs/pull/217/head and fork branches claude/pr217-parity-pr-core, claude/pr217-f4-f5-integration, claude/predeploy-config-validation
- Any GitHub Actions run of 'PI V1.02 PR Core' on 4a504e9 (all ci_run fields)
- Codex's #218 artifact-boundary review and City work (do not duplicate)

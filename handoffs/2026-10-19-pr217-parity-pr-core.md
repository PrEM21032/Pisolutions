# Handoff — 2026-10-19 — PR Core runs the deploy-configuration parity test

Window: owner-approved, ending 2026-10-19 20:12 UTC.
Branch: `PrEM21032/Pisolutions9:claude/pr217-parity-pr-core`, based on integration head `e026f56`
(F4 guard + F5 parity on #217 `9ec0def`). Code commit: `4a504e9807e986a0e9dc02e6d1744591f9035052`.

## Rechecked (19:17:18Z)
- #217 is at `9ec0def`; the fork's `claude/predeploy-config-validation` is also at `9ec0def` and untouched.
- The integration branch is at `e026f56`.
- Upstream main is at `13c0c94`.

## Why PR Core did not run parity
- Its steps were `npm run test:v1.02` and `node scripts/validate-deploy-configuration-test.mjs`. The `test:v1.02`
  script has no validate-deploy entry, and a grep for "parity" in `.github/` and `package.json` was empty.
- Its `paths:` trigger lacked `.github/workflows/pi-chat-worker.yml`. A PR changing only the shell rules
  would not have run PR Core at all.

## Change (additive: +6/-0 in pi-v102-pr-core.yml, plus a new test file)
- New trigger path: `.github/workflows/pi-chat-worker.yml`. This widens when PR Core runs; it removes nothing.
- New last step "Deploy configuration shell/validator parity (provider-free)" (`working-directory: worker`):
  - `node scripts/validate-deploy-configuration-parity-test.mjs` (45 cases);
  - `node scripts/pr-core-workflow-test.mjs` (new). It asserts:
    - the existing steps remain, in order: checkout, setup-node 22, install, `test:v1.02`, the focused test,
      then parity;
    - read-only permissions, timeout 10, the pull_request trigger on main, and all four trigger paths;
    - no `secrets.`, `wrangler`, `continue-on-error`, `|| true`, step `if:` or `pull_request_target`.
- `pi-chat-worker.yml`, `package.json`, thresholds and secret handling are unchanged.

## Local evidence (NOT CI)
| Check | Result |
|---|---|
| PyYAML 6.0.1 parse of both workflows | ok; step list as above |
| `git diff e026f56 -- .github` removed lines | 0 |
| `pr-core-workflow-test.mjs` | exit 0. Six mutations each exit 1: parity removed, `\|\| true`, trigger path removed, continue-on-error, focused step removed, secret referenced. Restored byte-identical. |
| `bash -e` replay of PR Core steps 4-6 | all exit 0 (19:18:15-19:18:47Z) |
| `npm run test:security`, `npm test` | exit 0 (19:19:00Z) |

## Not verified
- **No GitHub Actions run.** PR Core triggers on `pull_request` to main, and this branch has no PR.
- **ubuntu-latest specifics.** The `python`→`python3` fallback and the bash paths used by the parity stubs have
  not been checked on a GitHub runner.
- **actionlint** is not available here.

## Rollback
Delete the branch, or run `git revert 4a504e9`.

## Next
See `2026-10-19-pr217-parity-pr-core.next-prompt.md` (generated with the #218 builder at `1cf9229`; NOT dispatched).

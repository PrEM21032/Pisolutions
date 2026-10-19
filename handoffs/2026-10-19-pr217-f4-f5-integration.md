# Handoff — 2026-10-19 — #217 + F4 guard + F5 parity integration

Window: owner-approved, ending 2026-10-19 20:12 UTC.
Branch: `PrEM21032/Pisolutions9:claude/pr217-f4-f5-integration`, based on #217 head `9ec0def`.

## Refs checked (git ls-remote, 19:13:01Z)
- upstream main `13c0c94`
- #217 `9ec0def`; the fork branch `claude/predeploy-config-validation` is also at `9ec0def` and is untouched
- #218 `1cf9229`
- F4 branch `b4c9f58`, F5 branch `f09fadb`

There was no existing integration branch, so this work duplicates nothing.

## Integration
| Commit | Source | Content |
|---|---|---|
| `f0ac87bbacf54ae3a59485e1da232b8bfa3bf97c` | cherry-pick -x of `a16441b` (F4) | realpath entry guard + symlink/import regressions |
| `601db07402604339e77d87f1d3035b2a4b69e540` | cherry-pick -x of `a7202ca` (F5) | shell/validator parity test |

- No conflicts.
- The files are byte-identical to the source commits (`git diff --quiet`).
- `.github/` and `package.json` are unchanged against `9ec0def`, so there are no workflow or gate changes.
- Interaction checked: the parity test imports the F4-guarded validator. It still passes, and importing does
  not run the CLI (the F4 test asserts this).

## Local tests (all exit 0; NOT CI)
| Command | Time (UTC) |
|---|---|
| `cd worker && node scripts/validate-deploy-configuration-test.mjs` | 19:13:18 |
| `cd worker && node scripts/validate-deploy-configuration-parity-test.mjs` (45 cases) | 19:13 |
| `cd worker && node scripts/verify-provider-configuration-test.mjs` | 19:13 |
| Symlinked CLI with empty env gives exit 1 (F4); direct good env gives exit 0 with the success line | 19:13 |
| `npm run test:v1.02` | 19:13:52 |
| `npm run test:security` | 19:13 |
| `npm test` | 19:14:04 |

No `pi-parity-*` or `pi-validate-*` temp dirs remained.

## Acceptance (this window)
- F4 + F5 on a new isolated branch from current #217 head: done.
- No conflicts or substantive mismatch: none found.
- #217 branch, workflows and gates untouched: verified by diff and ls-remote.
- Focused and wider suites pass locally: done.
- CI: none (fork branch, no PR).

## Limitations
- No CI has run on these commits. #217's CI on `9ec0def` is Codex's relayed observation, not mine.
- The parity test is not in any workflow, so PR Core would run only the F4-extended focused test if this were adopted.
- This session has no verified upstream write or API access.
- Inherited limits:
  - F4: the guard still exits 0 silently if `argv[1]` cannot resolve to the file (for example, a wrapper that imports it).
  - F5: Cloudflare-required and live Stripe Price checks are not covered.

## Rollback
Delete the branch, or run `git revert 601db07 f0ac87b`. Nothing else changed.

## Next
See `2026-10-19-pr217-f4-f5-integration.next-prompt.md` (generated with the #218 builder at `1cf9229`; NOT dispatched).

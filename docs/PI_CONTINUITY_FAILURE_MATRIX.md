# PI Continuity Engine — failure-prevention matrix (v1)

These are the ten failure scenarios from the owner directive (V2, 2026-10-19), each mapped to the mechanism in
`pi/mission-ledger.mjs` / `pi/mission-git.mjs` and to the proof that exercises it. "Test §n" refers to
the numbered steps in `pi/mission-ledger-test.mjs` (run with `npm run test:continuity`). That test uses a real
temporary git repo and separate node processes. The crash, the second executor and the reviewer are simulated.

| # | Failure | Trigger | Recovery path | Proof | Remaining limit |
|---|---|---|---|---|---|
| 01 | Usage-limit interruption | Executor stops mid-task (simulated `exit 137` after a real commit, before the checkpoint) | Commits carry `Mission-Id`/`Mission-Task` trailers. A fresh process finds the commit in git and resumes at "run tests", not "implement". | Test §1–2: one commit only, `recovered_commit_from_trailer` | Work that was never committed is lost. Uncommitted edits are not checkpointed. |
| 02 | Lost conversation context | New session has no chat | `handoffs/mission-ledger.json` plus local git rebuild the mission state. `node pi/mission-git.mjs next/prompt` | Test §2 (fresh process); real-repo fresh-clone run (see the handoff) | Needs a checkout of the fork branch that holds the ledger. |
| 03 | GitHub permission failure | 403 or missing scope | The task `requires` an action that isn't in `authorized_actions`, so it shows as `needs_authorization:<action>` and is skipped. Other tasks continue. | Real ledger: C4 is skipped with `needs_authorization:github_read_upstream` | No automatic retry or escalation channel; the blocker is listed for the owner. |
| 04 | False completion | Status says "done" or "verified" | Levels (`claimed` < `implemented` < `tested` < `independently_verified` < `deployed` < `production_verified`) are *earned*: the commit must exist on the branch, tests must be tied to that commit and pass, and the review must come from another executor on the same commit. | Test §8: `claimed_above_evidence`, `unverifiable_offline`; §4: `review_not_independent` | Evidence records are supplied. A fabricated test record with the right shape still counts. |
| 05 | Duplicate agents | Claude and Codex take the same task | Leases (executor, full base sha, expiry). A foreign active lease is refused; an expired one can be taken over, and the takeover is recorded. A force-moved base is flagged `stale_base`. | Test §6 (lease held / takeover), §7 (stale base, lost verified work) | Leases live in the ledger file. Two writers on different machines are guarded only by the seq check at save time. |
| 06 | Planning without execution | Prompts instead of code | A task is "done" only when its evidence level reaches its `target`. A prompt or plan never raises a level. | Real ledger: C3 is done only through commit `c969913` plus tests on it | The selector can't judge whether a task is valuable, only whether it's eligible. |
| 07 | CI vs production confusion | Green CI read as "live" | `deployed` / `production_verified` can never be earned offline (`OFFLINE_CEILING`). The CI builder needs `subject_sha` (#218). | Test §8 (`unverifiable_offline:production_verified`) | Live verification is out of scope; it needs a separate owner-approved process. |
| 08 | Unsafe deploy / secret mutation | Task asks to deploy or write secrets | `FORBIDDEN_ACTIONS` (deploy, merge_protected, secret_write, billing, paid_call, hardware, force_push, approve_actions, owner_auth_bypass). These are never selected, and `authorize()` throws. | Test §5; real ledger C7 is skipped with `forbidden_action:deploy` | The engine enforces this only for itself; other tools must call `authorize()`. |
| 09 | Scheduling unavailable | No scheduler or agent running | The ledger plus `next`/`prompt` are a restartable mission. Nothing here claims a scheduler exists. | Continuation prompt says NOT DISPATCHED | No scheduler is configured. Automatic resumption is NOT IMPLEMENTED. |
| 10 | Wrong-goal continuation | Owner changes the objective | Each task carries an `objective_rev`. Tasks not re-confirmed for the current revision are skipped as `stale_intent`. | Test §9 | Re-confirming tasks is a manual ledger edit (checked by seq and checksum). |

## Checkpoint integrity
- Writes go to a temp file, then fsync, then rename.
- A checksum over key-sorted JSON detects edited or partial files (`ledger_corrupt`).
- Each write must name the `seq` it loaded. An older writer gets `stale_checkpoint` and the disk is unchanged
  (test §3, §10).
- Leftover `*.tmp-*` files are reported, never read.

## Advancing a mission (durable executor commands, `pi/mission-run.mjs`)
A fresh session needs only the repository:

```sh
node pi/mission-git.mjs check --ledger handoffs/mission-ledger.json          # contradictions, partial checkpoints, unsaved work under a lease
node pi/mission-git.mjs next  --ledger handoffs/mission-ledger.json --executor <name>
node pi/mission-run.mjs begin  --task <id> --executor <name>                 # only the selector's choice, clean tree, takes the lease
#   implement; commit with trailers: Mission-Id: <mission_id> / Mission-Task: <id>
node pi/mission-run.mjs verify --task <id> --executor <name> --cmd "<tests>"  # runs in a temp worktree at the task's exact commit
node pi/mission-run.mjs add-task --id <id> --intent "..." [--branch b] [--depends a,b]   # duplicate ids/intents refused
```

Commit the ledger after each command that changes it. When `next` returns no task, stop: the skipped reasons
are the blockers, so record them rather than inventing work.

(Why the 2026-10-19 20:37Z run stopped: `next` returned no eligible task. That was the designed stop. The structural
gap was that lease, evidence and task writes were done with scripts outside the repo, so a new session could not
advance the mission with repo tools. `mission-run.mjs` closes that gap.)

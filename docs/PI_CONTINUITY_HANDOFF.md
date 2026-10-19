# PI Continuity Handoff Builder

Provider-free, local tool implementing steps 2, 4 and 6 of the PI Continuity Engine protocol
(`docs/PI_CONTINUITY_ENGINE.md` on `coordination/continuity-engine-v1`). It turns an explicit
evidence file into a ready-to-paste next-session prompt with three buckets:
**VERIFIED DONE**, **IN PROGRESS**, **UNPROVEN / BLOCKED**.

It makes no network calls, reads no environment variables or secrets, and starts no session.
Every generated prompt says `NOT DISPATCHED`.

## Usage

```sh
node pi/continuity-handoff.mjs --evidence handoffs/<date>-<topic>.evidence.json \
  --now <ISO time the evidence was gathered> \
  --out handoffs/<date>-<topic>.next-prompt.md
npm run test:continuity
```

`--now` makes output deterministic; `--max-age-hours` (default 24) sets freshness.

## Evidence file

Top level: `generated_at`, `goal`, `repo {name, ref, sha?, work_branch?}`, `items[]`,
`next_action {task, acceptance[], avoid[]}`, `safety[]`, `rollback[]`, `next_inspect[]`.

Each item: `id`, `claim`, `status` (`verified | in_progress | unproven | blocked`), `scope`
(required when verified: `source | test | ci | live_deployment | running_session`) and
`evidence[]` entries `{kind, ref?, url?, observed_at?, exit_code?, observed_by?}`.

## Classification rules (enforced, not trusted)

A `verified` claim lands in VERIFIED DONE only when it has at least one evidence entry that:

1. is of a kind allowed for its scope:
   | scope | accepted proof kinds |
   |---|---|
   | source | commit, pr, doc |
   | test | test_run with `exit_code: 0` |
   | ci | ci_run |
   | live_deployment | live_probe **only** |
   | running_session | session_probe **only** |
2. carries a source link (`url` starting `https://` or a non-empty `ref`), and
3. has `observed_at` within the freshness window.

Otherwise it is demoted to UNPROVEN with the reason printed. So a plan, CI run, merged PR or
passing test can never make a deployment "live" or a session "running".
`in_progress` needs a pr/branch/commit/issue link or it is demoted too. `blocked` and
`unproven` are never promoted.

## Limitations

- It checks the shape of evidence, not its truth: a hand-written `live_probe` entry is
  accepted as written. Gather evidence with real commands and record who observed it.
- It does not fetch GitHub state itself (by design, so it stays provider-free and offline).
- Freshness is relative to `--now`; the committed prompt is a snapshot, not current state.

## Rollback

Additive only: `pi/continuity-handoff.mjs`, `pi/continuity-handoff-test.mjs`, this doc,
`handoffs/`, and the `test:continuity` script line in `package.json`. Revert the commit or
delete the branch. Nothing is wired into deploy or gate workflows.

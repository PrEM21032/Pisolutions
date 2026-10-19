import { readFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildPrompt, classifyItem, validateEvidence } from './continuity-handoff.mjs';

const now = Date.parse('2026-10-19T12:00:00Z');
const fresh = '2026-10-19T11:00:00Z';
const stale = '2026-10-10T00:00:00Z';
const expect = (cond, code) => { if (!cond) throw new Error(code); };
const bucket = (item) => classifyItem(item, { now }).bucket;

// Live deployment and running sessions can never be inferred from plans, CI, PRs or tests.
for (const kind of ['plan', 'ci_run', 'pr', 'test_run', 'commit', 'doc']) {
  const ev = { kind, url: 'https://github.com/x/y', observed_at: fresh, exit_code: 0 };
  expect(bucket({ id: 'd', claim: 'Worker live', status: 'verified', scope: 'live_deployment', evidence: [ev] }) === 'unproven', `live_inferred_from_${kind}`);
  expect(bucket({ id: 's', claim: 'Claude session running', status: 'verified', scope: 'running_session', evidence: [ev] }) === 'unproven', `session_inferred_from_${kind}`);
}
expect(bucket({ id: 'd', claim: 'Worker live', status: 'verified', scope: 'live_deployment', evidence: [{ kind: 'live_probe', url: 'https://example.invalid/health', observed_at: fresh }] }) === 'verified', 'direct_live_probe_rejected');

// Verified requires a source link, fresh observation and (for tests) exit code 0.
expect(bucket({ id: 'a', claim: 'c', status: 'verified', scope: 'source', evidence: [{ kind: 'commit', observed_at: fresh }] }) === 'unproven', 'unlinked_proof_accepted');
expect(bucket({ id: 'a', claim: 'c', status: 'verified', scope: 'source', evidence: [{ kind: 'commit', ref: 'abc123', observed_at: stale }] }) === 'unproven', 'stale_proof_accepted');
expect(bucket({ id: 'a', claim: 'c', status: 'verified', scope: 'source', evidence: [{ kind: 'commit', ref: 'abc123' }] }) === 'unproven', 'undated_proof_accepted');
expect(bucket({ id: 'a', claim: 'c', status: 'verified', scope: 'source', evidence: [{ kind: 'commit', ref: 'abc123', observed_at: fresh }] }) === 'verified', 'linked_fresh_commit_rejected');
expect(bucket({ id: 't', claim: 'c', status: 'verified', scope: 'test', evidence: [{ kind: 'test_run', ref: 'node x', observed_at: fresh, exit_code: 1 }] }) === 'unproven', 'failing_test_accepted');
expect(bucket({ id: 't', claim: 'c', status: 'verified', scope: 'test', evidence: [{ kind: 'test_run', ref: 'node x', observed_at: fresh, exit_code: 0 }] }) === 'verified', 'passing_test_rejected');
expect(bucket({ id: 'c', claim: 'c', status: 'verified', scope: 'ci', evidence: [{ kind: 'test_run', ref: 'local', observed_at: fresh, exit_code: 0 }] }) === 'unproven', 'local_test_counted_as_ci');

// In progress needs a branch/PR/issue link; blocked stays blocked.
expect(bucket({ id: 'p', claim: 'c', status: 'in_progress', evidence: [{ kind: 'plan', ref: 'doc' }] }) === 'unproven', 'in_progress_without_pr_accepted');
expect(bucket({ id: 'p', claim: 'c', status: 'in_progress', evidence: [{ kind: 'pr', url: 'https://github.com/x/y/pull/1' }] }) === 'in_progress', 'in_progress_with_pr_rejected');
expect(bucket({ id: 'b', claim: 'c', status: 'blocked', evidence: [{ kind: 'commit', ref: 'abc', observed_at: fresh }] }) === 'unproven', 'blocked_promoted');

// Validation rejects malformed input instead of guessing.
expect(validateEvidence({}).length > 0, 'empty_doc_accepted');
expect(validateEvidence({ goal: 'g', repo: { name: 'r', ref: 'main' }, next_action: { task: 't' }, items: [{ id: 'x', claim: 'c', status: 'done' }] }).includes('item_x_bad_status'), 'bad_status_accepted');

// The committed handoff evidence renders deterministically and matches the committed prompt.
const evidencePath = 'handoffs/2026-10-19-continuity-handoff.evidence.json';
const doc = JSON.parse(await readFile(evidencePath, 'utf8'));
doc.source_file = evidencePath;
const prompt = buildPrompt(doc, { now: Date.parse(doc.generated_at) });
for (const heading of ['## VERIFIED DONE', '## IN PROGRESS', '## UNPROVEN / BLOCKED', '## ONE next action', '## Safety boundaries', '## Rollback', '## Next handoff must inspect', 'NOT DISPATCHED']) {
  expect(prompt.includes(heading), `missing_${heading}`);
}
expect(prompt === buildPrompt(doc, { now: Date.parse(doc.generated_at) }), 'non_deterministic_output');
const committed = await readFile('handoffs/2026-10-19-continuity-handoff.next-prompt.md', 'utf8');
expect(committed === prompt, 'committed_prompt_out_of_date (regenerate with the CLI command in docs/PI_CONTINUITY_HANDOFF.md)');

// CLI round trip writes the same output.
const dir = '.pi-test-continuity';
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
execFileSync('node', ['pi/continuity-handoff.mjs', '--evidence', evidencePath, '--now', doc.generated_at, '--out', `${dir}/p.md`]);
expect((await readFile(`${dir}/p.md`, 'utf8')) === prompt, 'cli_output_mismatch');
await rm(dir, { recursive: true, force: true });

// Provider-free: the builder must not open network connections or spawn processes.
const src = await readFile('pi/continuity-handoff.mjs', 'utf8');
for (const banned of ['fetch(', "'node:http", "'node:https", "'node:net", 'child_process', 'process.env']) {
  expect(!src.includes(banned), `provider_free_violation_${banned}`);
}

console.log(JSON.stringify({ ok: true, liveNeverInferred: true, sessionNeverInferred: true, linksRequired: true, freshnessEnforced: true, committedPromptCurrent: true, providerFree: true }));

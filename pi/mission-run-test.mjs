// Executor CLI (pi/mission-run.mjs) against a real temporary git repo, every command in a fresh node process.
// Proves: duplicate tasks refused, only the selected task can begin, dirty trees refused, tests run on the task's
// exact commit (not HEAD), leases enforced, failing runs recorded honestly, worktrees cleaned up.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { continuationPrompt, loadLedger, reconcile, saveLedger, selectNext } from './mission-ledger.mjs';
import { gitFacts } from './mission-git.mjs';

const RUN = fileURLToPath(new URL('./mission-run.mjs', import.meta.url));
const box = mkdtempSync(join(tmpdir(), 'pi-run-'));
const repo = join(box, 'repo');
const ledgerPath = join(repo, 'ledger.json');
const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' }).trim();
const run = (...a) => spawnSync(process.execPath, [RUN, ...a, '--ledger', ledgerPath, '--repo', repo], { encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);

try {
  execFileSync('git', ['init', '-q', '-b', 'work', repo]);
  writeFileSync(join(repo, 'calc.mjs'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(repo, 'calc-test.mjs'), "import { add } from './calc.mjs';\nif (add(2, 3) !== 5) process.exit(1);\nconsole.log('calc ok');\n");
  g('add', '.'); g('commit', '-qm', 'base');
  saveLedger(ledgerPath, {
    mission_id: 'M-RUN', objective: 'run test', objective_rev: 1, repo, base_sha: g('rev-parse', 'HEAD'),
    authorized_actions: ['code', 'local_test'], tasks: []
  }, { expectSeq: 0 });
  g('add', 'ledger.json'); g('commit', '-qm', 'ledger');

  // add-task: new tasks accepted; duplicate ids and same intent (different case/punctuation) refused.
  assert.equal(run('add-task', '--id', 'R1', '--intent', 'Fix add()', '--branch', 'work', '--priority', '1').status, 0);
  assert.equal(run('add-task', '--id', 'R2', '--intent', 'Add sub()', '--branch', 'work', '--priority', '2', '--depends', 'R1').status, 0);
  assert.match(run('add-task', '--id', 'R1', '--intent', 'other').stderr, /duplicate_task_id:R1/);
  assert.match(run('add-task', '--id', 'R9', '--intent', '  fix ADD!! ').stderr, /duplicate_task_intent:R1/);
  assert.match(run('add-task', '--id', 'bad id', '--intent', 'x').stderr, /task id must be/);

  // begin: only the selector's choice, only on a clean tree.
  assert.match(run('begin', '--task', 'R2', '--executor', 'claude').stderr, /selector_chose:R1/);
  writeFileSync(join(repo, 'scratch.txt'), 'wip');
  assert.match(run('begin', '--task', 'R1', '--executor', 'claude').stderr, /uncommitted_changes:scratch\.txt/);
  rmSync(join(repo, 'scratch.txt'));
  // A modified tracked file (porcelain " M path", leading space) is reported with its full name.
  writeFileSync(join(repo, 'calc-test.mjs'), readFileSync(join(repo, 'calc-test.mjs'), 'utf8') + '\n');
  assert.match(run('begin', '--task', 'R1', '--executor', 'claude').stderr, /uncommitted_changes:calc-test\.mjs$/m);
  g('checkout', '--', 'calc-test.mjs');
  // The modified tracked ledger itself (" M ledger.json") does not count as dirty.
  assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }), /^ M ledger\.json$/m, 'precondition: ledger modified by add-task');
  const began = run('begin', '--task', 'R1', '--executor', 'claude');
  assert.equal(began.status, 0, began.stderr);
  assert.equal(out(began).step, 'implement');
  g('commit', '-qam', 'tasks and lease R1');

  // verify needs a task commit; then tests the exact commit even after HEAD moves on and breaks the code.
  assert.match(run('verify', '--task', 'R1', '--executor', 'claude', '--cmd', 'node calc-test.mjs').stderr, /no_verifiable_commit/);
  writeFileSync(join(repo, 'calc.mjs'), 'export const add = (a, b) => a + b;\n');
  g('commit', '-qam', 'Fix add\n\nMission-Id: M-RUN\nMission-Task: R1');
  const fixCommit = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'calc.mjs'), 'export const add = () => 0;\n');
  g('commit', '-qam', 'later unrelated breakage');
  assert.equal(spawnSync(process.execPath, ['calc-test.mjs'], { cwd: repo }).status, 1, 'HEAD itself is broken');
  assert.match(run('verify', '--task', 'R1', '--executor', 'codex', '--cmd', 'true').stderr, /lease_not_held_by:codex/);

  const failing = run('verify', '--task', 'R1', '--executor', 'claude', '--cmd', 'exit 3');
  assert.equal(failing.status, 1);
  assert.equal(out(failing).exit_code, 3);
  let { ledger } = loadLedger(ledgerPath);
  assert.equal(ledger.tasks.find((t) => t.id === 'R1').status, 'pending', 'failing run does not raise the level');
  assert.ok(reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R1.contradictions.includes('failing_test_on_commit'));
  g('commit', '-qam', 'record failing run');

  const passing = run('verify', '--task', 'R1', '--executor', 'claude', '--cmd', 'node calc-test.mjs');
  assert.equal(passing.status, 0, passing.stderr);
  const v = out(passing);
  assert.equal(v.commit, fixCommit, 'tested the task commit, not HEAD');
  assert.equal(v.exit_code, 0);
  assert.equal(v.worktree_removed, true);
  assert.deepEqual(v.tail, ['calc ok']);
  assert.equal(g('worktree', 'list').split('\n').length, 1, 'no worktree left behind');
  ({ ledger } = loadLedger(ledgerPath));
  const rec = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() });
  assert.equal(rec.R1.earned, 'tested');
  assert.equal(rec.R1.test_provenance, 'tool_recorded', 'verify marks its own records');
  assert.ok(!rec.R1.unknowns.includes('hand_written_test_evidence'));
  assert.equal(ledger.tasks.find((t) => t.id === 'R1').evidence.tests.at(-1).recorded_by, 'mission-run verify');
  assert.deepEqual(rec.R1.contradictions, []);
  assert.equal(selectNext(ledger, rec, { executor: 'claude', now: Date.now() }).task, 'R2', 'loop advances to the next task');
  assert.ok(!readFileSync(ledgerPath, 'utf8').includes('"in_worktree": false'));
  g('commit', '-qam', 'record R1 verify');

  // reverify: a done task with legacy (hand-written) records is re-run at the same commit and becomes tool-recorded.
  ({ ledger } = loadLedger(ledgerPath));
  const legacy = { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R1' ? { ...t, evidence: { ...t.evidence, tests: t.evidence.tests.map(({ recorded_by, ...rest }) => rest) } } : t)) };
  saveLedger(ledgerPath, legacy, { expectSeq: ledger.seq });
  g('commit', '-qam', 'legacy R1 record');
  ({ ledger } = loadLedger(ledgerPath));
  assert.equal(reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R1.test_provenance, 'hand_written', 'precondition: legacy record');
  assert.match(run('reverify', '--task', 'R2', '--executor', 'claude', '--cmd', 'true').stderr, /reverify_only_done_tasks:R2/);
  const codexLease = { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R1' ? { ...t, lease: { executor: 'codex', base_sha: fixCommit, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() } } : t)) };
  saveLedger(ledgerPath, codexLease, { expectSeq: ledger.seq });
  assert.match(run('reverify', '--task', 'R1', '--executor', 'claude', '--cmd', 'node calc-test.mjs').stderr, /lease_held:R1:codex/);
  ({ ledger } = loadLedger(ledgerPath));
  saveLedger(ledgerPath, { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R1' ? { ...t, lease: { ...t.lease, expires_at: new Date(Date.now() - 1000).toISOString() } } : t)) }, { expectSeq: ledger.seq });
  g('commit', '-qam', 'codex lease expired');
  const re = run('reverify', '--task', 'R1', '--executor', 'claude', '--cmd', 'node calc-test.mjs');
  assert.equal(re.status, 0, re.stderr);
  assert.equal(out(re).reverified, true);
  assert.equal(out(re).commit, fixCommit, 'reverify tests the same exact commit, not HEAD');
  assert.equal(g('worktree', 'list').split('\n').length, 1);
  ({ ledger } = loadLedger(ledgerPath));
  let r1 = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R1;
  assert.equal(r1.test_provenance, 'tool_recorded');
  assert.equal(r1.earned, 'tested');
  assert.equal(ledger.tasks.find((t) => t.id === 'R1').lease_history.at(-1).executor, 'codex', 'expired codex lease recorded on takeover');
  g('commit', '-qam', 'reverified R1');
  // note: supplied evidence is stored with provenance, shown in the prompt, and never raises a level.
  ({ ledger } = loadLedger(ledgerPath));
  const before = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R2;
  assert.equal(run('note', '--task', 'R2', '--kind', 'ci_run', '--by', 'owner relay', '--summary', 'PR Core completed/action_required, 0 jobs', '--url', 'https://github.com/x/y/actions/runs/1').status, 0);
  assert.match(run('note', '--task', 'R2', '--kind', 'ci_run', '--by', 'owner relay', '--summary', 'PR Core completed/action_required, 0 jobs', '--url', 'https://github.com/x/y/actions/runs/1').stderr, /duplicate_note/);
  assert.match(run('note', '--task', 'R2', '--kind', 'review', '--by', 'x', '--summary', 'y', '--url', 'http://insecure').stderr, /url must be https/);
  assert.match(run('note', '--task', 'R2', '--kind', 'approval', '--by', 'x', '--summary', 'y').stderr, /kind must be/);
  ({ ledger } = loadLedger(ledgerPath));
  const after = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R2;
  assert.equal(after.earned, before.earned, 'supplied note does not change the level');
  assert.equal(ledger.tasks.find((t) => t.id === 'R2').evidence.supplied[0].provenance, 'supplied');
  assert.match(continuationPrompt(ledger, reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }), { task: null, skipped: [] }), /SUPPLIED by owner relay \(relayed .*, not observed by this engine\): ci_run PR Core completed\/action_required, 0 jobs/);
  g('commit', '-qam', 'note on R2');
  // retest: a tested-but-unfinished task (awaiting independent review) gets tool-recorded tests at its exact commit,
  // stays tested/not done, and its short lease is released so the reviewer is not blocked.
  assert.equal(run('add-task', '--id', 'R4', '--intent', 'Feature awaiting review', '--branch', 'work', '--priority', '0', '--target', 'independently_verified').status, 0);
  writeFileSync(join(repo, 'review-me.mjs'), 'export const x = 1;\n');
  writeFileSync(join(repo, 'review-me-test.mjs'), "import { x } from './review-me.mjs';\nif (x !== 1) process.exit(1);\nconsole.log('review-me ok');\n");
  g('add', 'review-me.mjs', 'review-me-test.mjs'); g('commit', '-qam', 'Feature R4\n\nMission-Id: M-RUN\nMission-Task: R4');
  const r4Commit = g('rev-parse', 'HEAD');
  const b4 = run('begin', '--task', 'R4', '--executor', 'claude');
  assert.equal(b4.status, 0, b4.stderr);
  const v4 = run('verify', '--task', 'R4', '--executor', 'claude', '--cmd', 'node review-me-test.mjs');
  assert.equal(v4.status, 0, v4.stderr + v4.stdout);
  ({ ledger } = loadLedger(ledgerPath));
  // Make R4's record hand-written (as C1's is) and drop claude's lease, as after a finished session.
  saveLedger(ledgerPath, { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R4' ? { ...t, lease: null, evidence: { ...t.evidence, tests: t.evidence.tests.map(({ recorded_by, in_worktree, ...rest }) => rest) } } : t)) }, { expectSeq: ledger.seq });
  g('commit', '-qam', 'R4 tested by hand');
  ({ ledger } = loadLedger(ledgerPath));
  let r4 = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R4;
  assert.deepEqual([r4.earned, r4.done, r4.test_provenance], ['tested', false, 'hand_written'], 'precondition');
  assert.match(run('retest', '--task', 'R1', '--executor', 'claude', '--cmd', 'true').stderr, /retest_not_for_done_tasks:R1 \(use reverify\)/);
  assert.match(run('retest', '--task', 'R2', '--executor', 'claude', '--cmd', 'true').stderr, /retest_only_tested_unfinished:R2:pending/);
  saveLedger(ledgerPath, { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R4' ? { ...t, lease: { executor: 'codex', base_sha: r4Commit, acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() } } : t)) }, { expectSeq: ledger.seq });
  assert.match(run('retest', '--task', 'R4', '--executor', 'claude', '--cmd', 'node review-me-test.mjs').stderr, /lease_held:R4:codex/);
  ({ ledger } = loadLedger(ledgerPath));
  saveLedger(ledgerPath, { ...ledger, tasks: ledger.tasks.map((t) => (t.id === 'R4' ? { ...t, lease: null } : t)) }, { expectSeq: ledger.seq });
  g('commit', '-qam', 'codex lease gone');
  g('commit', '-q', '--allow-empty', '-m', 'HEAD moves on');
  const rt = run('retest', '--task', 'R4', '--executor', 'claude', '--cmd', 'node review-me-test.mjs');
  assert.equal(rt.status, 0, rt.stderr);
  assert.equal(out(rt).commit, r4Commit, 'retest tests the exact task commit, not HEAD');
  assert.equal(out(rt).lease_released, true);
  ({ ledger } = loadLedger(ledgerPath));
  const t4 = ledger.tasks.find((t) => t.id === 'R4');
  r4 = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R4;
  assert.deepEqual([r4.earned, r4.done, r4.test_provenance, t4.status], ['tested', false, 'tool_recorded', 'tested'], 'never above tested');
  assert.equal(t4.lease, null);
  assert.equal(t4.lease_history.at(-1).ended, 'released');
  assert.deepEqual(selectNext(ledger, reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }), { executor: 'codex', now: Date.now() }).task, 'R4', 'reviewer is not blocked by the retest lease');
  g('commit', '-qam', 'retested R4');

  // Regression (C15, found on da53c2d): a second same-executor session acquires a newer lease while a retest is still
  // running its tests (SIMULATED by the test command itself). The stale retest must not clear that newer lease.
  const racer = join(box, 'racer.mjs');
  writeFileSync(racer, `import { loadLedger, saveLedger, acquireLease } from ${JSON.stringify(new URL('./mission-ledger.mjs', import.meta.url).href)};
const { ledger } = loadLedger(${JSON.stringify(ledgerPath)});
const now = Date.now() + 5000;
const l = acquireLease(ledger, 'R4', 'claude', { now, ttlMinutes: 30, baseSha: ${JSON.stringify(r4Commit)} });
saveLedger(${JSON.stringify(ledgerPath)}, l, { expectSeq: ledger.seq });
console.log(l.tasks.find((t) => t.id === 'R4').lease.acquired_at);`);
  const raced = run('retest', '--task', 'R4', '--executor', 'claude', '--cmd', `node ${JSON.stringify(racer)}`);
  ({ ledger } = loadLedger(ledgerPath));
  const raceLease = ledger.tasks.find((t) => t.id === 'R4').lease;
  assert.ok(raceLease, `newer same-executor lease was cleared by the stale retest (exit ${raced.status}: ${raced.stderr.trim()})`);
  assert.ok(Date.parse(raceLease.acquired_at) > Date.now() - 60_000 && raceLease.acquired_at !== ledger.tasks.find((t) => t.id === 'R4').lease_history.at(-1)?.acquired_at, 'surviving lease is the newer one');
  assert.notEqual(raced.status, 0, 'the stale retest does not report success after losing its lease');
  assert.match(raced.stderr, /stale_checkpoint|lease_superseded/);
  assert.equal(reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R4.earned, 'tested', 'R4 evidence unchanged by the stale retest');
  g('commit', '-qam', 'race observed');
  // A genuine failure is recorded, demotes R4 visibly, still releases the lease, and sends R4 back into the loop.
  const rtBad = run('retest', '--task', 'R4', '--executor', 'claude', '--cmd', 'exit 5');
  assert.equal(rtBad.status, 1);
  ({ ledger } = loadLedger(ledgerPath));
  r4 = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R4;
  assert.equal(r4.earned, 'implemented');
  assert.ok(r4.contradictions.includes('failing_test_on_commit') && r4.contradictions.some((c) => c.startsWith('claimed_above_evidence:tested>')));
  assert.equal(ledger.tasks.find((t) => t.id === 'R4').lease, null);
  assert.match(run('retest', '--task', 'R4', '--executor', 'claude', '--cmd', 'true').stderr, /retest_only_tested_unfinished:R4:implemented/);
  g('commit', '-qam', 'R4 failed retest');

  // A failing re-run is recorded and visibly demotes the done task.
  const bad = run('reverify', '--task', 'R1', '--executor', 'claude', '--cmd', 'exit 4');
  assert.equal(bad.status, 1);
  ({ ledger } = loadLedger(ledgerPath));
  r1 = reconcile(ledger, gitFacts(repo, ledger), { now: Date.now() }).R1;
  assert.equal(r1.done, false);
  assert.ok(r1.contradictions.includes('failing_test_on_commit'));
} finally {
  rmSync(box, { recursive: true, force: true });
}
assert.ok(!existsSync(box));

const src = readFileSync(RUN, 'utf8');
for (const banned of ["'fetch'", "'push'", "'pull'", "'ls-remote'", 'wrangler', 'fetch(', 'process.env']) {
  assert.ok(!src.includes(banned), `mission-run.mjs must not use ${banned}`);
}
console.log(JSON.stringify({ ok: true, duplicateTasksRefused: true, onlySelectedTaskBegins: true, dirtyTreeRefused: true, exactCommitTested: true, leaseEnforced: true, failingRunRecorded: true, worktreeCleaned: true, toolRecordedLabelled: true, reverifyDoneTasks: true, suppliedNotesNeverPromote: true, retestTestedUnfinished: true }));

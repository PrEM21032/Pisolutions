// Executor CLI (pi/mission-run.mjs) against a real temporary git repo, every command in a fresh node process.
// Proves: duplicate tasks refused, only the selected task can begin, dirty trees refused, tests run on the task's
// exact commit (not HEAD), leases enforced, failing runs recorded honestly, worktrees cleaned up.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger, reconcile, saveLedger, selectNext } from './mission-ledger.mjs';
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
  g('commit', '-qam', 'tasks');

  // begin: only the selector's choice, only on a clean tree.
  assert.match(run('begin', '--task', 'R2', '--executor', 'claude').stderr, /selector_chose:R1/);
  writeFileSync(join(repo, 'scratch.txt'), 'wip');
  assert.match(run('begin', '--task', 'R1', '--executor', 'claude').stderr, /uncommitted_changes:scratch\.txt/);
  rmSync(join(repo, 'scratch.txt'));
  const began = run('begin', '--task', 'R1', '--executor', 'claude');
  assert.equal(began.status, 0, began.stderr);
  assert.equal(out(began).step, 'implement');
  g('commit', '-qam', 'lease R1');

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
  assert.deepEqual(rec.R1.contradictions, []);
  assert.equal(selectNext(ledger, rec, { executor: 'claude', now: Date.now() }).task, 'R2', 'loop advances to the next task');
  assert.ok(!readFileSync(ledgerPath, 'utf8').includes('"in_worktree": false'));
} finally {
  rmSync(box, { recursive: true, force: true });
}
assert.ok(!existsSync(box));

const src = readFileSync(RUN, 'utf8');
for (const banned of ["'fetch'", "'push'", "'pull'", "'ls-remote'", 'wrangler', 'fetch(', 'process.env']) {
  assert.ok(!src.includes(banned), `mission-run.mjs must not use ${banned}`);
}
console.log(JSON.stringify({ ok: true, duplicateTasksRefused: true, onlySelectedTaskBegins: true, dirtyTreeRefused: true, exactCommitTested: true, leaseEnforced: true, failingRunRecorded: true, worktreeCleaned: true }));

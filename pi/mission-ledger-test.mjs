// End-to-end interruption-recovery proof for the mission ledger, using a real temporary git repository and
// separate node processes (no shared memory, no chat history). SIMULATED: the crash (process.exit(137)),
// the second executor "codex-sim" and its review. Not simulated: git commits, the test command, file IO.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  acquireLease, authorize, continuationPrompt, loadLedger, reconcile, recordEvidence, saveLedger, selectNext, setStatus
} from './mission-ledger.mjs';
import { gitFacts } from './mission-git.mjs';

const LEDGER_URL = pathToFileURL(new URL('./mission-ledger.mjs', import.meta.url).pathname).href;
const GIT_URL = pathToFileURL(new URL('./mission-git.mjs', import.meta.url).pathname).href;
const box = mkdtempSync(join(tmpdir(), 'pi-mission-'));
const repo = join(box, 'repo');
const ledgerPath = join(box, 'ledger.json');
const T0 = Date.parse('2026-10-19T12:00:00Z');
const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const head = () => g('rev-parse', 'work');
const load = () => loadLedger(ledgerPath).ledger;
const state = (now = T0) => { const l = load(); return { l, rec: reconcile(l, gitFacts(repo, l), { now }) }; };

// A fresh node process that imports only the modules and the on-disk ledger.
function child(name, body, now) {
  const file = join(box, `${name}.mjs`);
  writeFileSync(file, `import * as L from ${JSON.stringify(LEDGER_URL)};
import { gitFacts } from ${JSON.stringify(GIT_URL)};
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const repo = ${JSON.stringify(repo)}, ledgerPath = ${JSON.stringify(ledgerPath)}, now = ${now};
const g = (...a) => execFileSync('git', ['-c','user.name=t','-c','user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' }).trim();
${body}`);
  return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}

try {
  // Real repository with a real bug and a real test.
  execFileSync('git', ['init', '-q', '-b', 'work', repo]);
  writeFileSync(join(repo, 'calc.mjs'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(repo, 'calc-test.mjs'), "import { add } from './calc.mjs';\nif (add(2, 3) !== 5) { console.error('add broken'); process.exit(1); }\nconsole.log('calc ok');\n");
  g('add', '.'); g('commit', '-qm', 'base');
  const base = head();
  assert.equal(spawnSync(process.execPath, ['calc-test.mjs'], { cwd: repo }).status, 1, 'baseline test must fail');

  saveLedger(ledgerPath, {
    mission_id: 'M-TEST', objective: 'Fix the calculator, then extend it', objective_rev: 1, repo, base_sha: base,
    authorized_actions: ['code', 'local_test'],
    tasks: [
      { id: 'T3', intent: 'deploy calculator', priority: 0, requires: ['deploy'], status: 'pending', objective_rev: 1 },
      { id: 'T1', intent: 'fix add()', branch: 'work', target: 'independently_verified', priority: 1, requires: ['code', 'local_test'], status: 'pending', objective_rev: 1 },
      { id: 'T2', intent: 'add sub()', branch: 'work', target: 'tested', priority: 2, depends_on: ['T1'], requires: ['code', 'local_test'], status: 'pending', objective_rev: 1 },
      { id: 'T4', intent: 'publish wiki page', priority: 3, requires: ['wiki_write'], status: 'pending', objective_rev: 1 },
      { id: 'T5', intent: 'write README (old objective)', branch: 'work', priority: 4, requires: ['code'], status: 'pending', objective_rev: 1 }
    ]
  }, { expectSeq: 0 });

  // 1. Executor A reconstructs the task from the ledger, takes a lease, makes a real commit, then crashes
  //    before checkpointing (and leaves a half-written temp file behind).
  const a = child('executor-a', `
const { ledger } = L.loadLedger(ledgerPath);
const rec = L.reconcile(ledger, gitFacts(repo, ledger), { now });
const next = L.selectNext(ledger, rec, { executor: 'claude', now });
if (next.task !== 'T1' || next.step !== 'implement') { console.error(JSON.stringify(next)); process.exit(3); }
L.saveLedger(ledgerPath, L.acquireLease(ledger, 'T1', 'claude', { now, baseSha: g('rev-parse', 'work') }), { expectSeq: ledger.seq });
writeFileSync(repo + '/calc.mjs', 'export const add = (a, b) => a + b;\\n');
g('commit', '-qam', 'Fix add\\n\\nMission-Id: M-TEST\\nMission-Task: T1');
writeFileSync(ledgerPath + '.tmp-99999', '{"partial');
process.exit(137);`, T0);
  assert.equal(a.status, 137, `executor A should crash: ${a.stderr}`);
  const t1Commit = head();
  assert.equal(load().tasks.find((t) => t.id === 'T1').evidence, undefined, 'crash happened before evidence was checkpointed');

  // 2. Fresh process B: no memory of A. It must find A's commit through git, not redo it, and run the tests.
  const before = load();
  const b = child('executor-b', `
const { ledger, leftovers } = L.loadLedger(ledgerPath);
const rec = L.reconcile(ledger, gitFacts(repo, ledger), { now });
const next = L.selectNext(ledger, rec, { executor: 'claude', now });
if (next.task !== 'T1' || next.step !== 'run_tests_on_commit') { console.error(JSON.stringify({ next, rec: rec.T1 })); process.exit(3); }
const run = spawnSync(process.execPath, ['calc-test.mjs'], { cwd: repo });
let l = L.recordEvidence(ledger, 'T1', { commit: rec.T1.commit, implemented_by: 'claude',
  tests: [{ cmd: 'node calc-test.mjs', exit_code: run.status, commit: rec.T1.commit, observed_at: new Date(now).toISOString() }] });
l = L.setStatus(l, 'T1', 'tested');
L.saveLedger(ledgerPath, l, { expectSeq: ledger.seq });
console.log(JSON.stringify({ leftovers, recovered: rec.T1.unknowns, exit: run.status }));`, T0 + 60_000);
  assert.equal(b.status, 0, b.stderr);
  const bOut = JSON.parse(b.stdout);
  assert.deepEqual(bOut.leftovers, ['ledger.json.tmp-99999'], 'partial checkpoint detected, not used');
  assert.ok(bOut.recovered.some((u) => u.startsWith('recovered_commit_from_trailer:')), 'commit recovered from git');
  assert.equal(bOut.exit, 0, 'real test passes on the recovered commit');
  assert.equal(g('log', '--format=%H', '--grep=Mission-Task: T1', 'work').split('\n').length, 1, 'no duplicate implementation');
  assert.equal(head(), t1Commit, 'B made no new commit');
  let { l, rec } = state(T0 + 60_000);
  assert.equal(rec.T1.earned, 'tested');
  assert.equal(rec.T1.commit, t1Commit);

  // 3. A stale writer holding the pre-B checkpoint is refused; disk is unchanged.
  const disk = readFileSync(ledgerPath, 'utf8');
  assert.throws(() => saveLedger(ledgerPath, setStatus(before, 'T1', 'pending'), { expectSeq: before.seq }), /stale_checkpoint/);
  assert.equal(readFileSync(ledgerPath, 'utf8'), disk);

  // 4. Independence: the implementer cannot review its own work; a different executor can.
  let next = selectNext(l, rec, { executor: 'claude', now: T0 });
  assert.equal(next.task, 'T5', 'with T1 awaiting review and T2 blocked behind it, the next eligible task is T5');
  assert.ok(next.skipped.some((s) => s.id === 'T1' && s.reason === 'needs_independent_reviewer'));
  assert.ok(next.skipped.some((s) => s.id === 'T2' && s.reason === 'depends_on:T1'));
  const selfReview = reconcile(recordEvidence(l, 'T1', { review: { by: 'claude', commit: t1Commit, ref: 'self' } }), gitFacts(repo, l), { now: T0 });
  assert.ok(selfReview.T1.contradictions.includes('review_not_independent'));
  assert.equal(selectNext(l, rec, { executor: 'codex-sim', now: T0 + 2 * 3_600_000 }).step, 'independent_review');
  // SIMULATED reviewer: records a review tied to the exact commit.
  saveLedger(ledgerPath, setStatus(recordEvidence(l, 'T1', { review: { by: 'codex-sim', commit: t1Commit, ref: 'review-note-1 (simulated reviewer)' } }), 'T1', 'independently_verified'), { expectSeq: l.seq });
  ({ l, rec } = state());
  assert.equal(rec.T1.earned, 'independently_verified');
  assert.ok(rec.T1.done);

  // 5. Unauthorized and unauthorized-yet work is never selected.
  next = selectNext(l, rec, { executor: 'claude', now: T0 });
  assert.equal(next.task, 'T2');
  assert.ok(next.skipped.some((s) => s.id === 'T3' && s.reason === 'forbidden_action:deploy'));
  assert.throws(() => authorize('deploy'), /forbidden_action:deploy/);
  assert.throws(() => authorize('secret_write'), /forbidden_action:secret_write/);

  // 6. Leases: claude takes T2; codex-sim is refused while it is active and may take over after expiry.
  l = acquireLease(l, 'T2', 'claude', { now: T0, ttlMinutes: 30, baseSha: head() });
  l = saveLedger(ledgerPath, l, { expectSeq: l.seq });
  assert.throws(() => acquireLease(l, 'T2', 'codex-sim', { now: T0 + 10 * 60_000, baseSha: head() }), /lease_held:T2:claude/);
  const takeover = acquireLease(l, 'T2', 'codex-sim', { now: T0 + 31 * 60_000, baseSha: head() });
  assert.equal(takeover.tasks.find((t) => t.id === 'T2').lease_history.at(-1).ended, 'expired_takeover');

  // 7. Conflict: another agent force-moves the branch so the leased base disappears from history.
  const leaseBase = head();
  g('checkout', '-q', 'HEAD~1');
  writeFileSync(join(repo, 'calc.mjs'), 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n');
  g('commit', '-qam', 'Add sub on a stale base\n\nMission-Id: M-TEST\nMission-Task: T2');
  g('branch', '-f', 'work', 'HEAD'); g('checkout', '-q', 'work');
  ({ l, rec } = state());
  assert.ok(rec.T2.contradictions.some((c) => c.startsWith(`stale_base:${leaseBase.slice(0, 7)}`)), JSON.stringify(rec.T2));
  assert.ok(rec.T1.contradictions.some((c) => c.startsWith('commit_not_on_branch')), 'verified T1 work lost from branch is flagged');
  assert.notEqual(selectNext(l, rec, { executor: 'claude', now: T0 }).task, 'T2', 'conflicted task is not continued');
  g('reset', '-q', '--hard', leaseBase); // temp repo only: restore the branch for the remaining checks

  // 8. False completion: claims above evidence are flagged and never count as done.
  ({ l, rec } = state());
  const lying = setStatus(setStatus(l, 'T2', 'independently_verified'), 'T3', 'production_verified');
  const lr = reconcile(lying, gitFacts(repo, lying), { now: T0 });
  assert.ok(lr.T2.contradictions.some((c) => c.startsWith('claimed_above_evidence:independently_verified>')));
  assert.ok(lr.T3.contradictions.includes('unverifiable_offline:production_verified'));
  assert.equal(lr.T2.done, false);

  // 9. Wrong-goal: the owner changes the objective; tasks not re-confirmed for it are not continued.
  const rev2 = { ...l, objective_rev: 2, tasks: l.tasks.map((t) => (['T1', 'T2'].includes(t.id) ? { ...t, objective_rev: 2 } : t)) };
  const r2 = reconcile(rev2, gitFacts(repo, rev2), { now: T0 });
  assert.equal(r2.T5.stale_intent, true);
  assert.equal(r2.T2.stale_intent, false, 'tasks re-confirmed for the new objective stay eligible');
  const onlyT5 = { ...rev2, tasks: rev2.tasks.filter((t) => t.id === 'T5') };
  const sel = selectNext(onlyT5, reconcile(onlyT5, gitFacts(repo, onlyT5), { now: T0 }), { executor: 'claude', now: T0 });
  assert.equal(sel.task, null);
  assert.deepEqual(sel.skipped, [{ id: 'T5', reason: 'stale_intent:objective_changed' }]);

  // CLI in a fresh process: `check` passes on a consistent ledger, fails on contradictions or leftovers; --out writes.
  const cli = (...a) => spawnSync(process.execPath, [new URL('./mission-git.mjs', import.meta.url).pathname, ...a, '--ledger', ledgerPath, '--repo', repo, '--now', new Date(T0).toISOString()], { encoding: 'utf8' });
  rmSync(`${ledgerPath}.tmp-99999`, { force: true });
  assert.equal(cli('check').status, 0, cli('check').stderr);
  const outFile = join(box, 'next-prompt.md');
  assert.equal(cli('prompt', '--out', outFile).status, 0);
  assert.match(readFileSync(outFile, 'utf8'), /- T2: implement/);
  writeFileSync(`${ledgerPath}.tmp-1`, '{');
  assert.equal(cli('check').status, 1, 'leftover partial checkpoint fails check');
  rmSync(`${ledgerPath}.tmp-1`);
  ({ l } = state());
  saveLedger(ledgerPath, setStatus(l, 'T3', 'production_verified'), { expectSeq: l.seq });
  const failing = cli('check');
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /T3: .*unverifiable_offline:production_verified/);
  const diskAfter = readFileSync(ledgerPath, 'utf8');

  // 10. Corrupted checkpoint is detected instead of trusted.
  writeFileSync(ledgerPath, diskAfter.replace('"pending"', '"tested"'));
  assert.throws(() => loadLedger(ledgerPath), /ledger_corrupt/);
  writeFileSync(ledgerPath, '{"sha256":');
  assert.throws(() => loadLedger(ledgerPath), /ledger_corrupt/);

  // Final checkpoint names the next executable safe step with exact shas.
  const prompt = continuationPrompt(l, rec, selectNext(l, rec, { executor: 'claude', now: T0 }));
  assert.match(prompt, /- T2: implement/);
  assert.ok(prompt.includes(t1Commit) && prompt.includes('NOT DISPATCHED'));
  assert.match(prompt, /skipped T3: forbidden_action:deploy/);
} finally {
  rmSync(box, { recursive: true, force: true });
}
assert.ok(!existsSync(box), 'temp mission dir removed');

// The ledger core must stay offline: no network modules, no child processes, no env reads.
const core = readFileSync(new URL('./mission-ledger.mjs', import.meta.url), 'utf8');
for (const banned of ['fetch(', "'node:http", "'node:https", "'node:net", "'node:tls", "'node:dns", 'child_process', 'process.env', 'WebSocket']) {
  assert.ok(!core.includes(banned), `mission-ledger.mjs must not use ${banned}`);
}
const gitSrc = readFileSync(new URL('./mission-git.mjs', import.meta.url), 'utf8');
for (const banned of ["'fetch'", "'push'", "'pull'", "'clone'", "'ls-remote'", "'remote'", "'commit'", "'reset'", "'checkout'", 'fetch(', 'process.env']) {
  assert.ok(!gitSrc.includes(banned), `mission-git.mjs must not use ${banned}`);
}

console.log(JSON.stringify({ ok: true, crashRecoveredFromGit: true, noDuplicateWork: true, staleWriterRefused: true, independentReviewRequired: true, forbiddenActionsBlocked: true, leaseConflictAndTakeover: true, staleBaseDetected: true, falseCompletionFlagged: true, staleIntentSkipped: true, corruptCheckpointDetected: true, cliCheckAndOut: true }));

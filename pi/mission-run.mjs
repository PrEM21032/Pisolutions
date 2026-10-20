// Executor side of the mission ledger: the durable commands that ADVANCE a mission, so a fresh session can
// continue with repository tools only (no ad-hoc scripts). Local only: no fetch, push, deploy or provider call.
//   add-task  --id C9 --intent "..." [--branch b] [--priority n] [--depends a,b] [--requires code,local_test] [--target tested]
//   begin     --task C9 --executor claude [--ttl 60]      # task must be the selector's choice; tree must be clean
//   verify    --task C9 --executor claude --cmd "<test>"  # runs <test> in a temp worktree at the task's exact commit
//   reverify  --task C8 --executor claude --cmd "<test>"  # already-done task: fresh lease, same exact-commit run
//   retest    --task C1 --executor claude --cmd "<test>"  # tested-but-unfinished task: same exact-commit run, lease released
//   note      --task C1 --kind review|ci_run --by "<who relayed it>" --summary "..." [--url https://...]
//             # records SUPPLIED external evidence with provenance; it is shown in prompts and never raises a level
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_RECORDER, acquireLease, leaseActive, loadLedger, reconcile, recordEvidence, saveLedger, selectNext, setStatus } from './mission-ledger.mjs';
import { dirtyPaths, gitFacts } from './mission-git.mjs';

export { dirtyPaths };

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const normalize = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function addTask(ledgerPath, spec) {
  const { ledger } = loadLedger(ledgerPath);
  if (!/^[A-Za-z0-9_-]+$/.test(spec.id || '')) fail('BAD_ID', 'task id must be [A-Za-z0-9_-]+');
  if (ledger.tasks.some((t) => t.id === spec.id)) fail('DUPLICATE', `duplicate_task_id:${spec.id}`);
  const same = ledger.tasks.find((t) => normalize(t.intent) === normalize(spec.intent));
  if (same) fail('DUPLICATE', `duplicate_task_intent:${same.id}`);
  const task = {
    id: spec.id, intent: spec.intent, branch: spec.branch, target: spec.target || 'tested', priority: Number(spec.priority ?? 50),
    depends_on: spec.depends_on || [], requires: spec.requires || ['code', 'local_test'], status: 'pending', objective_rev: ledger.objective_rev
  };
  return saveLedger(ledgerPath, { ...ledger, tasks: [...ledger.tasks, task] }, { expectSeq: ledger.seq });
}

export function begin(ledgerPath, repo, taskId, executor, { now = Date.now(), ttlMinutes = 60 } = {}) {
  const dirty = dirtyPaths(repo, ledgerPath);
  if (dirty.length) fail('DIRTY', `uncommitted_changes:${dirty.join(',')}`);
  const { ledger } = loadLedger(ledgerPath);
  const next = selectNext(ledger, reconcile(ledger, gitFacts(repo, ledger), { now }), { executor, now });
  if (next.task !== taskId) fail('NOT_SELECTED', `selector_chose:${next.task ?? 'none'}`);
  const saved = saveLedger(ledgerPath, acquireLease(ledger, taskId, executor, { now, ttlMinutes, baseSha: git(repo, ['rev-parse', 'HEAD']) }), { expectSeq: ledger.seq });
  return { seq: saved.seq, step: next.step, lease: saved.tasks.find((t) => t.id === taskId).lease };
}

export function verify(ledgerPath, repo, taskId, executor, cmd, { now = Date.now() } = {}) {
  const dirty = dirtyPaths(repo, ledgerPath);
  if (dirty.length) fail('DIRTY', `uncommitted_changes:${dirty.join(',')}`);
  const { ledger } = loadLedger(ledgerPath);
  const task = ledger.tasks.find((t) => t.id === taskId) || fail('UNKNOWN', `unknown_task:${taskId}`);
  if (!leaseActive(task.lease, now) || task.lease.executor !== executor) fail('NO_LEASE', `lease_not_held_by:${executor}`);
  const r = reconcile(ledger, gitFacts(repo, ledger), { now })[taskId];
  // Re-running tests is the remedy for test contradictions, so only commit/branch problems block verification.
  const blocking = r.contradictions.filter((c) => !['failing_test_on_commit', 'tests_not_tied_to_commit'].includes(c));
  if (!r.commit || blocking.length) fail('NO_COMMIT', `no_verifiable_commit:${blocking.join(';') || 'none_found'}`);
  // Test the exact commit, not whatever is checked out.
  const box = mkdtempSync(join(tmpdir(), 'pi-verify-'));
  const tree = join(box, 'tree');
  let run;
  try {
    git(repo, ['worktree', 'add', '--detach', '--quiet', tree, r.commit]);
    if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(realpathSync(repo), 'node_modules'), join(tree, 'node_modules'));
    run = spawnSync('bash', ['-c', cmd], { cwd: tree, encoding: 'utf8', timeout: 15 * 60_000 });
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', tree]); } catch { /* removed below */ }
    rmSync(box, { recursive: true, force: true });
    git(repo, ['worktree', 'prune']);
  }
  const exit = run.status ?? 1;
  let l = recordEvidence(ledger, taskId, {
    commit: r.commit, implemented_by: task.evidence?.implemented_by || executor,
    tests: [...(task.evidence?.tests || []).filter((t) => t.commit !== r.commit), { cmd, exit_code: exit, commit: r.commit, observed_at: new Date(now).toISOString(), in_worktree: true, recorded_by: TOOL_RECORDER }]
  });
  // A passing run on the exact commit earns 'tested'; it never lowers a higher recorded level. The latest run per
  // commit replaces earlier ones, so a failing re-run is visible (reconcile flags failing_test_on_commit).
  if (exit === 0 && ['pending', 'claimed', 'implemented'].includes(task.status)) l = setStatus(l, taskId, 'tested');
  const saved = saveLedger(ledgerPath, l, { expectSeq: ledger.seq });
  return { seq: saved.seq, commit: r.commit, exit_code: exit, worktree_removed: !existsSync(tree), tail: (run.stdout + run.stderr).trim().split('\n').slice(-3) };
}

export function note(ledgerPath, taskId, { kind, by, summary, url, now = Date.now() }) {
  if (!['review', 'ci_run', 'other'].includes(kind)) fail('BAD_KIND', 'kind must be review, ci_run or other');
  if (!by || !summary) fail('BAD_NOTE', 'note needs --by and --summary');
  if (url && !/^https:\/\//.test(url)) fail('BAD_NOTE', 'url must be https');
  const { ledger } = loadLedger(ledgerPath);
  const task = ledger.tasks.find((t) => t.id === taskId) || fail('UNKNOWN', `unknown_task:${taskId}`);
  const entry = { kind, supplied_by: by, summary, ...(url ? { url } : {}), relayed_at: new Date(now).toISOString(), provenance: 'supplied' };
  const supplied = [...(task.evidence?.supplied || [])];
  if (supplied.some((x) => x.kind === kind && x.summary === summary && x.url === entry.url)) fail('DUPLICATE', 'duplicate_note');
  return saveLedger(ledgerPath, recordEvidence(ledger, taskId, { supplied: [...supplied, entry] }), { expectSeq: ledger.seq });
}

// Re-run the tests of an already-done task at the same commit (e.g. to replace hand-written or legacy records with
// tool-recorded ones). Only done tasks: unfinished work must go through the selector via begin/verify. Takes its own
// lease, so a foreign active lease is refused. A failing re-run is recorded and demotes the task visibly.
export function reverify(ledgerPath, repo, taskId, executor, cmd, { now = Date.now(), ttlMinutes = 60 } = {}) {
  const dirty = dirtyPaths(repo, ledgerPath);
  if (dirty.length) fail('DIRTY', `uncommitted_changes:${dirty.join(',')}`);
  const { ledger } = loadLedger(ledgerPath);
  const r = reconcile(ledger, gitFacts(repo, ledger), { now })[taskId] || fail('UNKNOWN', `unknown_task:${taskId}`);
  if (!r.done) fail('NOT_DONE', `reverify_only_done_tasks:${taskId}:${r.earned}`);
  // The lease base is the task's own commit: re-verification builds nothing new on top of HEAD.
  saveLedger(ledgerPath, acquireLease(ledger, taskId, executor, { now, ttlMinutes, baseSha: r.commit }), { expectSeq: ledger.seq });
  return { reverified: true, ...verify(ledgerPath, repo, taskId, executor, cmd, { now }) };
}

// Re-run the tests of a task whose evidence earns exactly 'tested' but is not done (typically waiting for an
// independent review), to replace hand-written records with tool-recorded ones. It never implements, never selects
// work and never raises a level above 'tested'. Done tasks use reverify; anything below 'tested' uses begin/verify.
// The short lease is released afterwards so the task stays available to its reviewer.
export function retest(ledgerPath, repo, taskId, executor, cmd, { now = Date.now(), ttlMinutes = 30 } = {}) {
  const dirty = dirtyPaths(repo, ledgerPath);
  if (dirty.length) fail('DIRTY', `uncommitted_changes:${dirty.join(',')}`);
  const { ledger } = loadLedger(ledgerPath);
  const r = reconcile(ledger, gitFacts(repo, ledger), { now })[taskId] || fail('UNKNOWN', `unknown_task:${taskId}`);
  if (r.done) fail('USE_REVERIFY', `retest_not_for_done_tasks:${taskId} (use reverify)`);
  if (r.earned !== 'tested') fail('NOT_TESTED', `retest_only_tested_unfinished:${taskId}:${r.earned} (use begin/verify)`);
  if (r.contradictions.length) fail('CONTRADICTED', `retest_refused:${r.contradictions.join(';')}`);
  const acquired = saveLedger(ledgerPath, acquireLease(ledger, taskId, executor, { now, ttlMinutes, baseSha: r.commit }), { expectSeq: ledger.seq });
  const token = acquired.tasks.find((t) => t.id === taskId).lease.token;
  let released = false;
  let result;
  try {
    result = verify(ledgerPath, repo, taskId, executor, cmd, { now });
  } finally {
    // Release only the lease this call acquired. If another session (even the same executor) has since taken a newer
    // lease, leave it alone: clearing it would let two sessions believe they own the task.
    const { ledger: after } = loadLedger(ledgerPath);
    const task = after.tasks.find((t) => t.id === taskId);
    if (task.lease?.token === token) {
      const freed = { ...task, lease: null, lease_history: [...(task.lease_history || []), { ...task.lease, ended: 'released', ended_at: new Date(now).toISOString() }] };
      saveLedger(ledgerPath, { ...after, tasks: after.tasks.map((t) => (t.id === taskId ? freed : t)) }, { expectSeq: after.seq });
      released = true;
    }
  }
  if (!released) fail('LEASE_SUPERSEDED', `lease_superseded:${taskId}: a newer lease was taken during retest; it was left in place`);
  return { retested: true, ...result, lease_released: true };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = Object.fromEntries(rest.reduce((acc, a, i) => (a.startsWith('--') ? [...acc, [a.slice(2), rest[i + 1]]] : acc), []));
  const ledgerPath = args.ledger || 'handoffs/mission-ledger.json';
  const repo = args.repo || '.';
  const list = (v) => (v ? v.split(',').filter(Boolean) : undefined);
  let out;
  if (cmd === 'add-task') out = { seq: addTask(ledgerPath, { id: args.id, intent: args.intent, branch: args.branch, priority: args.priority, depends_on: list(args.depends), requires: list(args.requires), target: args.target }).seq };
  else if (cmd === 'begin') out = begin(ledgerPath, repo, args.task, args.executor || 'claude', { ttlMinutes: Number(args.ttl || 60), now: args.now ? Date.parse(args.now) : Date.now() });
  else if (cmd === 'verify') out = verify(ledgerPath, repo, args.task, args.executor || 'claude', args.cmd, { now: args.now ? Date.parse(args.now) : Date.now() });
  else if (cmd === 'note') out = { seq: note(ledgerPath, args.task, { kind: args.kind, by: args.by, summary: args.summary, url: args.url }).seq };
  else if (cmd === 'retest') out = retest(ledgerPath, repo, args.task, args.executor || 'claude', args.cmd, { now: args.now ? Date.parse(args.now) : Date.now() });
  else if (cmd === 'reverify') out = reverify(ledgerPath, repo, args.task, args.executor || 'claude', args.cmd, { now: args.now ? Date.parse(args.now) : Date.now() });
  else { console.error('usage: node pi/mission-run.mjs <add-task|begin|verify|reverify|retest|note> [--ledger handoffs/mission-ledger.json] ...'); process.exit(2); }
  console.log(JSON.stringify(out));
  if (['verify', 'reverify', 'retest'].includes(cmd) && out.exit_code !== 0) process.exit(1);
}

function isEntryPoint(argvPath) {
  if (!argvPath) return false;
  try { return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntryPoint(process.argv[1])) main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });

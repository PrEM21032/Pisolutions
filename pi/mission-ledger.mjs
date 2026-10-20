// PI Continuity Engine — mission ledger.
// A durable, checksummed record of one owner mission: objective, scope, tasks, leases, evidence and
// checkpoints. Pure logic plus atomic file IO; repository facts come from pi/mission-git.mjs (local git
// only). It never deploys, merges, reads secrets or calls a provider, and it never upgrades a task past
// what the evidence and the repository show.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

// Ordered evidence levels. They are never interchangeable: each needs its own proof.
export const LEVELS = ['pending', 'claimed', 'implemented', 'tested', 'independently_verified', 'deployed', 'production_verified'];
const rank = (level) => LEVELS.indexOf(level);
// The highest level an offline ledger can ever earn; deployment and production need live evidence.
export const OFFLINE_CEILING = 'independently_verified';
// Action categories this engine refuses to perform or schedule, whatever the ledger says.
export const FORBIDDEN_ACTIONS = ['deploy', 'merge_protected', 'secret_write', 'billing', 'paid_call', 'hardware', 'force_push', 'approve_actions', 'owner_auth_bypass'];
const FULL_SHA = /^[0-9a-f]{40}$/;
// Marker written by `mission-run verify` on the test records it produces.
export const TOOL_RECORDER = 'mission-run verify';
const isoNow = (now) => new Date(now).toISOString();

export function authorize(action) {
  if (FORBIDDEN_ACTIONS.includes(action)) throw Object.assign(new Error(`forbidden_action:${action}`), { code: 'FORBIDDEN' });
  return true;
}

// ---- checkpoints: atomic, checksummed, sequence-guarded ----
// Key-sorted serialization so the checksum does not depend on property order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digest = (text) => createHash('sha256').update(text).digest('hex');

export function loadLedger(path) {
  const leftovers = readdirSync(dirname(path)).filter((f) => f.startsWith(`${basename(path)}.tmp-`));
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw Object.assign(new Error('ledger_corrupt: unreadable json'), { code: 'CORRUPT' });
  }
  if (!raw?.ledger || raw.sha256 !== digest(canonical(raw.ledger))) {
    throw Object.assign(new Error('ledger_corrupt: checksum mismatch'), { code: 'CORRUPT' });
  }
  return { ledger: raw.ledger, leftovers };
}

// Writes ledger.seq = expectSeq + 1 only if the file on disk is still at expectSeq; a stale writer that
// loaded an older checkpoint is refused instead of silently overwriting newer verified work.
export function saveLedger(path, ledger, { expectSeq }) {
  if (existsSync(path)) {
    const onDisk = loadLedger(path).ledger;
    if (onDisk.seq !== expectSeq) {
      throw Object.assign(new Error(`stale_checkpoint: disk seq ${onDisk.seq}, writer expected ${expectSeq}`), { code: 'STALE' });
    }
  } else if (expectSeq !== 0) {
    throw Object.assign(new Error('stale_checkpoint: no ledger on disk'), { code: 'STALE' });
  }
  const next = { ...ledger, seq: expectSeq + 1 };
  const body = canonical(next);
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify({ sha256: digest(body), ledger: next }, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  return next;
}

// ---- leases ----
export function leaseActive(lease, now) {
  return Boolean(lease) && Date.parse(lease.expires_at) > now;
}

export function acquireLease(ledger, taskId, executor, { now, ttlMinutes = 60, baseSha }) {
  const task = findTask(ledger, taskId);
  if (!FULL_SHA.test(baseSha || '')) throw new Error('lease_needs_full_base_sha');
  const held = task.lease;
  if (leaseActive(held, now) && held.executor !== executor) {
    throw Object.assign(new Error(`lease_held:${taskId}:${held.executor}:until:${held.expires_at}`), { code: 'LEASE_HELD' });
  }
  const history = [...(task.lease_history || [])];
  if (held && held.executor !== executor) history.push({ ...held, ended: 'expired_takeover', ended_at: isoNow(now), by: executor });
  const lease = { executor, base_sha: baseSha, acquired_at: isoNow(now), expires_at: isoNow(now + ttlMinutes * 60_000) };
  return withTask(ledger, taskId, { lease, lease_history: history });
}

// ---- evidence ----
export function recordEvidence(ledger, taskId, patch) {
  const task = findTask(ledger, taskId);
  return withTask(ledger, taskId, { evidence: { ...(task.evidence || {}), ...patch } });
}

// ---- reconciliation: claims vs repository facts ----
// facts (from pi/mission-git.mjs): { commits: { sha: { exists, parents[] } }, ancestor(a, b) -> bool,
// branchHeads: { branch: sha|null }, taskCommits: { taskId: [sha] } }
export function reconcile(ledger, facts, { now }) {
  const out = {};
  for (const task of ledger.tasks) {
    const ev = task.evidence || {};
    const contradictions = [];
    const unknowns = [];
    let earned = task.status === 'claimed' || task.lease ? 'claimed' : 'pending';
    let commit = ev.commit || null;
    const found = facts.taskCommits?.[task.id] || [];
    if (!commit && found.length === 1) {
      commit = found[0];
      unknowns.push(`recovered_commit_from_trailer:${commit.slice(0, 7)}`);
    } else if (!commit && found.length > 1) {
      // Fix-up commits on one line of history are normal: the newest one (descendant of all others) is the task's
      // commit. Commits that diverge are a conflict.
      const newest = found.find((c) => found.every((o) => o === c || facts.ancestor(o, c)));
      if (newest) {
        commit = newest;
        unknowns.push(`recovered_commit_from_trailer:${commit.slice(0, 7)}`, `task_commits:${found.length}`);
      } else {
        contradictions.push(`multiple_task_commits:${found.map((s) => s.slice(0, 7)).join(',')}`);
      }
    }
    if (commit) {
      const head = facts.branchHeads?.[task.branch];
      if (!FULL_SHA.test(commit)) contradictions.push('commit_not_full_sha');
      else if (!facts.commits?.[commit]?.exists) contradictions.push(`commit_missing_in_repo:${commit.slice(0, 7)}`);
      else if (!head) unknowns.push(`branch_unknown:${task.branch}`);
      else if (!facts.ancestor(commit, head)) contradictions.push(`commit_not_on_branch:${task.branch}`);
      else {
        earned = 'implemented';
        const base = task.lease?.base_sha || ev.base_sha;
        if (base && facts.commits[commit] && !facts.commits[commit].parents.includes(base) && !facts.ancestor(base, commit)) {
          contradictions.push(`stale_base:${base.slice(0, 7)}_not_ancestor_of_${commit.slice(0, 7)}`);
          earned = 'claimed';
        } else if (base && !facts.commits[commit].parents.includes(base)) {
          unknowns.push(`base_moved:${base.slice(0, 7)}->parent_${facts.commits[commit].parents[0]?.slice(0, 7)}`);
        }
      }
    }
    const tests = ev.tests || [];
    let testProvenance = null;
    if (rank(earned) >= rank('implemented') && tests.length) {
      const onCommit = tests.filter((t) => t.commit === commit);
      if (!onCommit.length) contradictions.push('tests_not_tied_to_commit');
      else if (onCommit.some((t) => t.exit_code !== 0)) contradictions.push('failing_test_on_commit');
      else {
        earned = 'tested';
        // Tool-recorded = written by `mission-run verify` (ran in a worktree at the commit). Anything else was
        // typed into the ledger. This is a provenance label, not authentication: the fields can be copied.
        testProvenance = onCommit.every((t) => t.in_worktree === true && t.recorded_by === TOOL_RECORDER) ? 'tool_recorded' : 'hand_written';
        if (testProvenance === 'hand_written') unknowns.push('hand_written_test_evidence');
      }
    }
    const review = ev.review;
    if (review) {
      const implementer = task.lease_history?.[0]?.executor || task.lease?.executor || ev.implemented_by;
      if (rank(earned) < rank('tested')) contradictions.push('review_before_tests');
      else if (review.commit !== commit) contradictions.push('review_not_on_commit');
      else if (!review.by || review.by === implementer || review.by === ev.implemented_by) contradictions.push('review_not_independent');
      else if (!review.ref) unknowns.push('review_without_reference');
      else earned = 'independently_verified';
    }
    if (rank(task.status) > rank(OFFLINE_CEILING)) contradictions.push(`unverifiable_offline:${task.status}`);
    if (rank(task.status) > rank(earned)) contradictions.push(`claimed_above_evidence:${task.status}>${earned}`);
    if (rank(earned) > rank(task.status)) unknowns.push(`evidence_ahead_of_ledger:${task.status}->${earned}`);
    const stale = (task.objective_rev ?? ledger.objective_rev) < ledger.objective_rev;
    const doneNow = rank(earned) >= rank(task.target || 'tested');
    // An executor that stopped mid-task leaves an expired lease; make that abandoned work visible.
    if (task.lease && !leaseActive(task.lease, now) && !doneNow) {
      unknowns.push(`lease_expired_unfinished:${task.lease.executor}@${task.lease.expires_at}`);
    }
    out[task.id] = {
      claimed: task.status,
      earned,
      commit,
      test_provenance: testProvenance,
      done: doneNow,
      stale_intent: stale,
      lease: task.lease ? { ...task.lease, active: leaseActive(task.lease, now) } : null,
      contradictions,
      unknowns
    };
  }
  return out;
}

// ---- task selection ----
// Returns the next task this executor may work on, with the concrete step, or why nothing is eligible.
export function selectNext(ledger, rec, { executor, now }) {
  const skipped = [];
  const order = [...ledger.tasks].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  for (const task of order) {
    const r = rec[task.id];
    if (r.done) continue;
    const forbidden = (task.requires || []).filter((a) => FORBIDDEN_ACTIONS.includes(a));
    if (forbidden.length) { skipped.push({ id: task.id, reason: `forbidden_action:${forbidden.join(',')}` }); continue; }
    const needs = (task.requires || []).filter((a) => !(ledger.authorized_actions || []).includes(a));
    if (needs.length) { skipped.push({ id: task.id, reason: `needs_authorization:${needs.join(',')}` }); continue; }
    if (r.stale_intent) { skipped.push({ id: task.id, reason: 'stale_intent:objective_changed' }); continue; }
    const unmet = (task.depends_on || []).filter((d) => !rec[d]?.done);
    if (unmet.length) { skipped.push({ id: task.id, reason: `depends_on:${unmet.join(',')}` }); continue; }
    if (r.contradictions.length) { skipped.push({ id: task.id, reason: `contradictions:${r.contradictions.join(';')}` }); continue; }
    // Lease expiry is re-checked at selection time; a reconcile computed earlier must not keep an expired lease alive.
    if (leaseActive(task.lease, now) && task.lease.executor !== executor) { skipped.push({ id: task.id, reason: `leased_by:${task.lease.executor}` }); continue; }
    const step = r.earned === 'implemented' ? 'run_tests_on_commit'
      : r.earned === 'tested' ? 'independent_review'
      : 'implement';
    if (step === 'independent_review' && (r.lease?.executor === executor || task.evidence?.implemented_by === executor)) {
      skipped.push({ id: task.id, reason: 'needs_independent_reviewer' });
      continue;
    }
    return { task: task.id, step, commit: r.commit, skipped };
  }
  return { task: null, step: null, skipped };
}

// ---- continuation prompt ----
export function continuationPrompt(ledger, rec, next) {
  const lines = [
    `# PI mission ${ledger.mission_id} — continuation (seq ${ledger.seq})`,
    '',
    '> Built offline from the mission ledger and local git. NOT DISPATCHED. Levels are earned from evidence;',
    '> deployed / production_verified can never be earned offline. "tool-recorded" tests were written by',
    '> `mission-run verify` in a worktree at the commit; HAND-WRITTEN ones were typed in. Neither label is authentication.',
    '',
    `Objective (rev ${ledger.objective_rev}): ${ledger.objective}`,
    `Repository: ${ledger.repo} @ base ${ledger.base_sha}`,
    '',
    '## Tasks (claimed -> earned)'
  ];
  for (const t of ledger.tasks) {
    const r = rec[t.id];
    const notes = [...r.contradictions.map((c) => `CONTRADICTION ${c}`), ...r.unknowns].join('; ');
    const prov = r.test_provenance === 'tool_recorded' ? ' (tests: tool-recorded)' : r.test_provenance === 'hand_written' ? ' (tests: HAND-WRITTEN)' : '';
    lines.push(`- ${t.id} [${r.claimed} -> ${r.earned}${r.done ? ', done' : ''}]${prov} ${t.intent}${r.commit ? ` @ ${r.commit}` : ''}${notes ? ` — ${notes}` : ''}`);
  }
  lines.push('', '## Next safe action');
  lines.push(next.task ? `- ${next.task}: ${next.step}${next.commit ? ` (commit ${next.commit})` : ''}` : '- none eligible for this executor');
  for (const s of next.skipped) lines.push(`- skipped ${s.id}: ${s.reason}`);
  if (ledger.blockers?.length) lines.push('', '## Owner-controlled blockers', ...ledger.blockers.map((b) => `- ${b}`));
  if (ledger.recovery?.length) lines.push('', '## Recovery', ...ledger.recovery.map((r) => `- ${r}`));
  lines.push('', '## Never', ...FORBIDDEN_ACTIONS.map((a) => `- ${a}`), '');
  return lines.join('\n');
}

// ---- helpers ----
function findTask(ledger, taskId) {
  const task = ledger.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown_task:${taskId}`);
  return task;
}
function withTask(ledger, taskId, patch) {
  return { ...ledger, tasks: ledger.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) };
}
export function setStatus(ledger, taskId, status) {
  if (!LEVELS.includes(status)) throw new Error(`bad_status:${status}`);
  return withTask(ledger, taskId, { status });
}

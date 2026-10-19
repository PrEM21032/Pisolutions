// Repository facts for the mission ledger, read from LOCAL git only (no fetch, push or network).
// Task commits are found by trailers in the commit message, so work survives an interruption even if
// the executor died before it could checkpoint the ledger:
//   Mission-Id: <mission_id>
//   Mission-Task: <task id>
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync, writeFileSync } from 'node:fs';
import { loadLedger, reconcile, selectNext, continuationPrompt } from './mission-ledger.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/;
const READ_ONLY = new Set(['rev-parse', 'cat-file', 'merge-base', 'log', 'show']);

function git(repo, args) {
  if (!READ_ONLY.has(args[0])) throw new Error(`git_command_not_allowed:${args[0]}`);
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
function tryGit(repo, args) {
  try { return git(repo, args); } catch { return null; }
}

export function branchHead(repo, branch) {
  if (!branch) return null;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const sha = tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (sha) return sha;
  }
  return null;
}

export function gitFacts(repo, ledger) {
  const commits = {};
  const describe = (sha) => {
    if (!FULL_SHA.test(sha || '')) return;
    if (commits[sha]) return;
    const exists = tryGit(repo, ['cat-file', '-e', `${sha}^{commit}`]) !== null;
    const parents = exists ? (git(repo, ['rev-parse', `${sha}^@`]) || '').split('\n').filter(Boolean) : [];
    commits[sha] = { exists, parents };
  };
  const ancestor = (a, b) => tryGit(repo, ['merge-base', '--is-ancestor', a, b]) !== null;
  const branchHeads = {};
  const taskCommits = {};
  for (const task of ledger.tasks) {
    if (task.branch && !(task.branch in branchHeads)) branchHeads[task.branch] = branchHead(repo, task.branch);
  }
  for (const [branch, head] of Object.entries(branchHeads)) {
    if (!head) continue;
    const range = FULL_SHA.test(ledger.base_sha || '') && ancestor(ledger.base_sha, head) ? `${ledger.base_sha}..${head}` : head;
    const log = tryGit(repo, ['log', '--format=%H%x1f%B%x1e', range]) || '';
    for (const entry of log.split('\x1e')) {
      const [sha, body = ''] = entry.trim().split('\x1f');
      if (!FULL_SHA.test(sha || '')) continue;
      const mission = body.match(/^Mission-Id:\s*(\S+)\s*$/m)?.[1];
      const taskId = body.match(/^Mission-Task:\s*(\S+)\s*$/m)?.[1];
      if (mission !== ledger.mission_id || !taskId) continue;
      const task = ledger.tasks.find((t) => t.id === taskId);
      if (!task || task.branch !== branch) continue;
      (taskCommits[taskId] ||= []).push(sha);
    }
  }
  for (const task of ledger.tasks) {
    describe(task.evidence?.commit);
    describe(task.lease?.base_sha);
    describe(task.evidence?.base_sha);
    for (const sha of taskCommits[task.id] || []) describe(sha);
  }
  describe(ledger.base_sha);
  return { commits, ancestor, branchHeads, taskCommits };
}

// CLI: node pi/mission-git.mjs <reconcile|next|prompt|check> --ledger <file> [--repo <dir>] [--executor <name>] [--now <ISO>] [--out <file>]
// `check` exits 1 when any task has a contradiction, so a script can stop before acting on a bad ledger.
async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = Object.fromEntries(rest.reduce((acc, a, i) => (a.startsWith('--') ? [...acc, [a.slice(2), rest[i + 1]]] : acc), []));
  if (!['reconcile', 'next', 'prompt', 'check'].includes(cmd) || !args.ledger) {
    console.error('usage: node pi/mission-git.mjs <reconcile|next|prompt|check> --ledger <file> [--repo <dir>] [--executor <name>] [--now <ISO>] [--out <file>]');
    process.exit(2);
  }
  const now = args.now ? Date.parse(args.now) : Date.now();
  const { ledger, leftovers } = loadLedger(args.ledger);
  const rec = reconcile(ledger, gitFacts(args.repo || '.', ledger), { now });
  const next = selectNext(ledger, rec, { executor: args.executor || 'claude', now });
  if (cmd === 'check') {
    const bad = Object.entries(rec).filter(([, r]) => r.contradictions.length).map(([id, r]) => `${id}: ${r.contradictions.join('; ')}`);
    if (leftovers.length) bad.push(`leftover partial checkpoints: ${leftovers.join(', ')}`);
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
    console.log(`ledger ${ledger.mission_id} seq ${ledger.seq}: no contradictions`);
    return;
  }
  const text = cmd === 'reconcile' ? JSON.stringify({ seq: ledger.seq, leftovers, tasks: rec }, null, 2) + '\n'
    : cmd === 'next' ? JSON.stringify(next, null, 2) + '\n'
    : continuationPrompt(ledger, rec, next);
  if (args.out) writeFileSync(args.out, text);
  else process.stdout.write(text);
}

function isEntryPoint(argvPath) {
  if (!argvPath) return false;
  try { return realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntryPoint(process.argv[1])) main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });

// PI Continuity Engine — provider-free handoff builder.
// Builds a next-session prompt from an explicit evidence file. It performs no network
// calls, reads no secrets and never infers state: every bucket placement comes from the
// evidence entries supplied, and claims about live deployment or running sessions are
// only accepted with a direct probe of that exact thing.
import { readFile, writeFile } from 'node:fs/promises';

export const STATUSES = ['verified', 'in_progress', 'unproven', 'blocked'];
export const EVIDENCE_KINDS = ['commit', 'test_run', 'ci_run', 'pr', 'branch', 'issue', 'doc', 'plan', 'live_probe', 'session_probe'];

// Which evidence kinds may prove a verified claim of a given scope.
// A plan, CI run, merged PR or passing test can never prove live deployment or a running session.
export const PROOF_KINDS = {
  source: ['commit', 'pr', 'doc'],
  test: ['test_run'],
  ci: ['ci_run'],
  live_deployment: ['live_probe'],
  running_session: ['session_probe']
};

export const DEFAULT_MAX_AGE_HOURS = 24;

function hasLink(entry) {
  return typeof entry?.url === 'string' && /^https:\/\//.test(entry.url)
    || typeof entry?.ref === 'string' && entry.ref.trim().length > 0;
}

function ageHours(observedAt, now) {
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 3_600_000;
}

export function validateEvidence(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['evidence_not_object'];
  if (!doc.goal) errors.push('missing_goal');
  if (!doc.repo?.name || !doc.repo?.ref) errors.push('missing_repo_ref');
  if (!doc.next_action?.task) errors.push('missing_next_action');
  if (!Array.isArray(doc.items)) errors.push('items_not_array');
  for (const [i, item] of (doc.items || []).entries()) {
    if (!item.id || !item.claim) errors.push(`item_${i}_missing_id_or_claim`);
    if (!STATUSES.includes(item.status)) errors.push(`item_${item.id || i}_bad_status`);
    if (item.status === 'verified' && !PROOF_KINDS[item.scope]) errors.push(`item_${item.id || i}_bad_scope`);
    for (const ev of item.evidence || []) {
      if (!EVIDENCE_KINDS.includes(ev.kind)) errors.push(`item_${item.id || i}_bad_evidence_kind_${ev.kind}`);
    }
  }
  return errors;
}

// Returns { bucket, reasons } for one item. Buckets: verified | in_progress | unproven.
export function classifyItem(item, { now, maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const linked = evidence.filter(hasLink);
  if (item.status === 'blocked' || item.status === 'unproven') {
    return { bucket: 'unproven', reasons: [item.status === 'blocked' ? 'reported_blocked' : 'reported_unproven'] };
  }
  if (item.status === 'in_progress') {
    const tracked = linked.some((ev) => ['pr', 'branch', 'commit', 'issue'].includes(ev.kind));
    return tracked
      ? { bucket: 'in_progress', reasons: [] }
      : { bucket: 'unproven', reasons: ['in_progress_without_branch_pr_or_issue_link'] };
  }
  // status === 'verified': must be earned.
  const allowed = PROOF_KINDS[item.scope] || [];
  const proofs = linked.filter((ev) => allowed.includes(ev.kind));
  if (!proofs.length) {
    const offered = [...new Set(evidence.map((ev) => ev.kind))].join(',') || 'none';
    return { bucket: 'unproven', reasons: [`no_direct_${item.scope}_proof(offered:${offered})`] };
  }
  const fresh = proofs.filter((ev) => ev.observed_at && ageHours(ev.observed_at, now) <= maxAgeHours);
  if (!fresh.length) return { bucket: 'unproven', reasons: [`stale_or_undated_proof(>${maxAgeHours}h)`] };
  if (item.scope === 'test' && !fresh.some((ev) => ev.exit_code === 0)) {
    return { bucket: 'unproven', reasons: ['test_run_without_exit_code_0'] };
  }
  return { bucket: 'verified', reasons: [] };
}

export function classifyAll(doc, opts) {
  const out = { verified: [], in_progress: [], unproven: [] };
  for (const item of doc.items) {
    const { bucket, reasons } = classifyItem(item, opts);
    out[bucket].push({ ...item, reasons, demoted: item.status === 'verified' && bucket !== 'verified' });
  }
  return out;
}

function linkList(item) {
  const links = (item.evidence || []).filter(hasLink).map((ev) => {
    const label = `${ev.kind}${ev.ref ? `:${ev.ref}` : ''}`;
    return ev.url ? `[${label}](${ev.url})` : `\`${label}\``;
  });
  return links.length ? links.join(', ') : '_no source link_';
}

function bucketLines(items, emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => {
    const note = item.reasons.length ? ` — ${item.demoted ? 'DEMOTED from verified: ' : ''}${item.reasons.join('; ')}` : '';
    return `- **${item.id}** — ${item.claim} — ${linkList(item)}${note}`;
  });
}

export function buildPrompt(doc, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const errors = validateEvidence(doc);
  if (errors.length) throw new Error(`invalid_evidence: ${errors.join(', ')}`);
  const b = classifyAll(doc, { now, maxAgeHours });
  const na = doc.next_action;
  const list = (xs, fallback) => (xs?.length ? xs.map((x) => `- ${x}`) : [`- ${fallback}`]);
  return [
    '# PI Continuity — next-session prompt',
    '',
    `> Generated ${new Date(now).toISOString()} by \`pi/continuity-handoff.mjs\` from \`${doc.source_file || 'evidence input'}\`.`,
    '> NOT DISPATCHED. This file is a ready-to-paste prompt; no session was started by generating it.',
    '> Buckets are computed from the evidence entries only. Plans, CI and merged PRs never count as live deployment or a running session.',
    '',
    '## Goal',
    doc.goal,
    '',
    '## Repository / ref (re-fetch before acting)',
    `- ${doc.repo.name} @ \`${doc.repo.ref}\`${doc.repo.sha ? ` (observed sha \`${doc.repo.sha}\`)` : ''}`,
    ...(doc.repo.work_branch ? [`- Work branch: \`${doc.repo.work_branch}\``] : []),
    '',
    '## VERIFIED DONE',
    ...bucketLines(b.verified, '_nothing verified with direct, fresh, linked evidence_'),
    '',
    '## IN PROGRESS',
    ...bucketLines(b.in_progress, '_nothing tracked in progress_'),
    '',
    '## UNPROVEN / BLOCKED',
    ...bucketLines(b.unproven, '_none recorded_'),
    '',
    '## ONE next action',
    na.task,
    '',
    '### Acceptance criteria',
    ...list(na.acceptance, 'state measurable acceptance before starting'),
    '',
    '### Do not duplicate',
    ...list(na.avoid, 'check open PRs before starting'),
    '',
    '## Safety boundaries',
    ...list(doc.safety, 'no deploy, merge, secrets, billing, paid provider calls or hardware motion'),
    '',
    '## Rollback',
    ...list(doc.rollback, 'delete the isolated work branch'),
    '',
    '## Next handoff must inspect',
    ...list(doc.next_inspect, 'canonical main, open issues/PRs, CI on current heads'),
    ''
  ].join('\n');
}

async function main(argv) {
  const args = Object.fromEntries(argv.reduce((acc, a, i) => (a.startsWith('--') ? [...acc, [a.slice(2), argv[i + 1]]] : acc), []));
  if (!args.evidence) {
    console.error('usage: node pi/continuity-handoff.mjs --evidence <file.json> [--out <file.md>] [--now <ISO>] [--max-age-hours N]');
    process.exit(2);
  }
  const doc = JSON.parse(await readFile(args.evidence, 'utf8'));
  doc.source_file ||= args.evidence;
  const now = args.now ? Date.parse(args.now) : Date.now();
  if (Number.isNaN(now)) throw new Error('bad --now');
  const prompt = buildPrompt(doc, { now, maxAgeHours: args['max-age-hours'] ? Number(args['max-age-hours']) : DEFAULT_MAX_AGE_HOURS });
  if (args.out) await writeFile(args.out, prompt);
  else process.stdout.write(prompt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}

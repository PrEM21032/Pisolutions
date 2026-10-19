// PI Continuity Engine — provider-free handoff builder.
// Builds a next-session prompt from an explicit evidence file. It performs no network
// calls, reads no secrets and never infers state: every bucket placement comes from the
// evidence entries supplied. The generator observes nothing itself, so it can never verify
// live deployment or a running session: supplied probes for those are shown as ATTESTED
// (unauthenticated, re-probe before relying) under UNPROVEN, never as VERIFIED DONE.
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';

export const STATUSES = ['verified', 'in_progress', 'unproven', 'blocked'];
export const EVIDENCE_KINDS = ['commit', 'test_run', 'ci_run', 'pr', 'branch', 'issue', 'doc', 'plan', 'live_probe', 'session_probe'];

// Which evidence kinds may prove a verified claim of a given scope.
export const PROOF_KINDS = {
  source: ['commit', 'pr', 'doc'],
  test: ['test_run'],
  ci: ['ci_run']
};

// Scopes an offline generator can never verify. A plan, CI run, merged PR or passing test
// is never accepted for them, and even a direct probe is only an unauthenticated attestation.
export const ATTEST_ONLY_SCOPES = {
  live_deployment: 'live_probe',
  running_session: 'session_probe'
};

// Fields a probe must carry before it is even shown as an attestation.
export const PROBE_PROVENANCE_FIELDS = ['url', 'observed_at', 'observed_by', 'method', 'result'];

export const DEFAULT_MAX_AGE_HOURS = 24;

const FULL_SHA = /^[0-9a-f]{40}$/;
const HTTPS = /^https:\/\//;

// What counts as a source link differs by kind: commits need a full sha, remote things an https URL.
function hasLink(entry) {
  if (!entry) return false;
  if (entry.kind === 'commit') return FULL_SHA.test(entry.ref || '');
  if (['pr', 'issue', 'doc', 'ci_run', 'live_probe', 'session_probe'].includes(entry.kind)) {
    return typeof entry.url === 'string' && HTTPS.test(entry.url);
  }
  return typeof entry.url === 'string' && HTTPS.test(entry.url)
    || typeof entry.ref === 'string' && entry.ref.trim().length > 0;
}

// A timestamp later than the generation time cannot be an observation; allow only small clock skew.
export const MAX_CLOCK_SKEW_MINUTES = 5;

// Returns 'fresh' | 'stale' | 'future' | 'undated'.
export function freshness(observedAt, now, maxAgeHours) {
  const t = Date.parse(observedAt);
  if (!observedAt || Number.isNaN(t)) return 'undated';
  if (t - now > MAX_CLOCK_SKEW_MINUTES * 60_000) return 'future';
  return (now - t) / 3_600_000 <= maxAgeHours ? 'fresh' : 'stale';
}

// A ci_run proves CI only when the supplied record says it completed successfully, ran at least
// one job, and names the exact commit it ran on. Returns the missing/failed requirements.
export function ciRunProblems(ev) {
  const problems = [];
  if (ev.status !== 'completed') problems.push(`status:${ev.status ?? 'missing'}`);
  if (ev.conclusion !== 'success') problems.push(`conclusion:${ev.conclusion ?? 'missing'}`);
  if (!Number.isInteger(ev.jobs) || ev.jobs < 1) problems.push(`jobs:${ev.jobs ?? 'missing'}`);
  if (!FULL_SHA.test(ev.head_sha || '')) problems.push('head_sha:not_full_sha');
  return problems;
}

// Optional offline integrity check: a probe may point at a saved response file inside the
// repo plus its sha256. A match proves only that the file is unchanged since it was recorded,
// not that it came from the live system.
export function checkArtifact(ev, readArtifact = (p) => readFileSync(p)) {
  if (!ev.artifact && !ev.sha256) return 'no_artifact';
  if (!ev.artifact || !ev.sha256) return 'artifact_and_sha256_must_be_given_together';
  const p = normalize(ev.artifact);
  if (isAbsolute(p) || p.startsWith('..')) return 'artifact_path_outside_repo';
  let bytes;
  try { bytes = readArtifact(p); } catch { return 'artifact_missing'; }
  return createHash('sha256').update(bytes).digest('hex') === ev.sha256 ? 'artifact_sha256_matches' : 'artifact_sha256_mismatch';
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
    if (item.status === 'verified' && !PROOF_KINDS[item.scope] && !ATTEST_ONLY_SCOPES[item.scope]) errors.push(`item_${item.id || i}_bad_scope`);
    for (const ev of item.evidence || []) {
      if (!EVIDENCE_KINDS.includes(ev.kind)) errors.push(`item_${item.id || i}_bad_evidence_kind_${ev.kind}`);
    }
  }
  return errors;
}

function classifyAttestOnly(item, evidence, { now, maxAgeHours, readArtifact }) {
  const probeKind = ATTEST_ONLY_SCOPES[item.scope];
  const probes = evidence.filter((ev) => ev.kind === probeKind);
  const base = `not_verifiable_by_offline_generator(${item.scope})`;
  if (!probes.length) {
    const offered = [...new Set(evidence.map((ev) => ev.kind))].join(',') || 'none';
    return { bucket: 'unproven', attested: false, reasons: [base, `no_${probeKind}(offered:${offered})`] };
  }
  for (const ev of probes) {
    const missing = PROBE_PROVENANCE_FIELDS.filter((f) => f === 'url' ? !hasLink(ev) : !ev[f]);
    if (missing.length) continue;
    if (freshness(ev.observed_at, now, maxAgeHours) !== 'fresh') continue;
    const artifact = checkArtifact(ev, readArtifact);
    if (artifact !== 'no_artifact' && artifact !== 'artifact_sha256_matches') continue;
    return {
      bucket: 'unproven',
      attested: true,
      reasons: [base, `ATTESTED by ${ev.observed_by} at ${ev.observed_at} via ${ev.method} -> ${ev.result}`, artifact, 'unauthenticated: re-probe before relying']
    };
  }
  const ev = probes[0];
  const missing = PROBE_PROVENANCE_FIELDS.filter((f) => f === 'url' ? !hasLink(ev) : !ev[f]);
  const why = missing.length ? `probe_missing_provenance(${missing.join(',')})`
    : freshness(ev.observed_at, now, maxAgeHours) === 'future' ? 'future_observed_at'
    : freshness(ev.observed_at, now, maxAgeHours) !== 'fresh' ? `stale_probe(>${maxAgeHours}h)`
    : checkArtifact(ev, readArtifact);
  return { bucket: 'unproven', attested: false, reasons: [base, why] };
}

// Returns { bucket, reasons, attested? } for one item. Buckets: verified | in_progress | unproven.
export function classifyItem(item, { now, maxAgeHours = DEFAULT_MAX_AGE_HOURS, readArtifact } = {}) {
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
  if (ATTEST_ONLY_SCOPES[item.scope]) return classifyAttestOnly(item, evidence, { now, maxAgeHours, readArtifact });
  const allowed = PROOF_KINDS[item.scope] || [];
  const proofs = linked.filter((ev) => allowed.includes(ev.kind));
  if (!proofs.length) {
    const offered = [...new Set(evidence.map((ev) => ev.kind))].join(',') || 'none';
    return { bucket: 'unproven', reasons: [`no_linked_${item.scope}_proof(offered:${offered})`] };
  }
  const fresh = proofs.filter((ev) => freshness(ev.observed_at, now, maxAgeHours) === 'fresh');
  if (!fresh.length) {
    const future = proofs.some((ev) => freshness(ev.observed_at, now, maxAgeHours) === 'future');
    return { bucket: 'unproven', reasons: [future ? 'future_observed_at' : `stale_or_undated_proof(>${maxAgeHours}h)`] };
  }
  if (item.scope === 'ci' && !fresh.some((ev) => ciRunProblems(ev).length === 0)) {
    return { bucket: 'unproven', reasons: [`ci_run_not_completed_success(${ciRunProblems(fresh[0]).join(',')})`] };
  }
  if (item.scope === 'test' && !fresh.some((ev) => ev.exit_code === 0)) {
    return { bucket: 'unproven', reasons: ['test_run_without_exit_code_0'] };
  }
  return { bucket: 'verified', reasons: [] };
}

export function classifyAll(doc, opts) {
  const out = { verified: [], in_progress: [], unproven: [] };
  for (const item of doc.items) {
    const { bucket, reasons, attested = false } = classifyItem(item, opts);
    out[bucket].push({ ...item, reasons, attested, demoted: item.status === 'verified' && bucket !== 'verified' });
  }
  // Defence in depth: nothing in an attest-only scope may ever reach VERIFIED DONE.
  if (out.verified.some((item) => ATTEST_ONLY_SCOPES[item.scope])) throw new Error('attest_only_scope_classified_verified');
  return out;
}

function linkList(item) {
  const links = (item.evidence || []).filter(hasLink).map((ev) => {
    const label = `${ev.kind}${ev.ref ? `:${ev.ref}` : ''}`;
    const by = ev.observed_by ? ` (supplied by ${ev.observed_by})` : ' (supplier not recorded)';
    return (ev.url ? `[${label}](${ev.url})` : `\`${label}\``) + by;
  });
  return links.length ? links.join(', ') : '_no source link_';
}

function bucketLines(items, emptyText) {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => {
    const tag = item.attested ? 'ATTESTED, NOT VERIFIED: ' : item.demoted ? 'DEMOTED from verified: ' : '';
    const note = item.reasons.length ? ` — ${tag}${item.reasons.join('; ')}` : '';
    return `- **${item.id}** — ${item.claim} — ${linkList(item)}${note}`;
  });
}

export function buildPrompt(doc, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, readArtifact } = {}) {
  const errors = validateEvidence(doc);
  if (errors.length) throw new Error(`invalid_evidence: ${errors.join(', ')}`);
  const b = classifyAll(doc, { now, maxAgeHours, readArtifact });
  const na = doc.next_action;
  const list = (xs, fallback) => (xs?.length ? xs.map((x) => `- ${x}`) : [`- ${fallback}`]);
  return [
    '# PI Continuity — next-session prompt',
    '',
    `> Generated ${new Date(now).toISOString()} by \`pi/continuity-handoff.mjs\` from \`${doc.source_file || 'evidence input'}\`.`,
    '> NOT DISPATCHED. This file is a ready-to-paste prompt; no session was started by generating it.',
    '> Buckets are computed from the evidence entries only. Plans, CI and merged PRs never count as live deployment or a running session.',
    '',
    '## Trust limits (read before relying on any bucket)',
    '- This generator ran offline and observed nothing itself. Every entry below is supplied evidence; the supplier is shown next to each link.',
    '- VERIFIED DONE means only: the supplied evidence is of the right kind for the claim, linked (full commit sha or https URL), and fresh (not older than the window, not later than generation time). It does not authenticate the evidence.',
    '- A CI claim needs a supplied ci_run record saying status completed, conclusion success, at least one job, and the full head sha it ran on. The generator did not fetch that run; re-read it before relying on it.',
    '- Live deployment and running-session claims are never VERIFIED DONE here. A supplied probe with full provenance is shown as ATTESTED, NOT VERIFIED under UNPROVEN / BLOCKED; re-probe before relying on it.',
    '- An artifact sha256 match proves only that a saved file is unchanged since it was recorded, not that it came from the live system.',
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

// Parity regression (review finding F5 on #217): the offline validator re-implements the fallback and
// Stripe decisions that the post-deploy shell steps in .github/workflows/pi-chat-worker.yml make. This test
// extracts those two `run:` scripts from the workflow file and executes them under bash with every external
// command that could reach a provider (curl, npx/wrangler) replaced by a local stub, then checks that the
// shell and the validator accept/refuse the same inputs.
//
// What it covers: partial/complete/absent fallback (KEY/URL/MODEL), partial/complete/absent Stripe, and the
// Stripe key/webhook/price prefix decisions, including whitespace and trailing-newline values.
// What it cannot cover: the required Cloudflare credentials (the shell has no explicit check; only
// `wrangler deploy` itself fails without them), the live Stripe Price checks (the curl stub returns a
// matching Price, so the live gate is NOT exercised), and how GitHub Actions populates env from secrets.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeployConfiguration } from './validate-deploy-configuration.mjs';

const workflowPath = fileURLToPath(new URL('../../.github/workflows/pi-chat-worker.yml', import.meta.url));
const workflow = readFileSync(workflowPath, 'utf8').split('\n');

// Minimal extractor for a `run: |` block of a named step; fails loudly if the layout changes.
function stepScript(name) {
  const start = workflow.findIndex(line => line.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `workflow step not found: ${name}`);
  const stepIndent = workflow[start].indexOf('-');
  let runLine = -1;
  for (let i = start + 1; i < workflow.length; i += 1) {
    const indent = workflow[i].search(/\S/);
    if (indent !== -1 && indent <= stepIndent) break;
    if (workflow[i].trim() === 'run: |') { runLine = i; break; }
  }
  assert.ok(runLine > 0, `run block not found for step: ${name}`);
  const runIndent = workflow[runLine].search(/\S/);
  const body = [];
  for (let i = runLine + 1; i < workflow.length; i += 1) {
    const line = workflow[i];
    const indent = line.search(/\S/);
    if (indent !== -1 && indent <= runIndent) break;
    body.push(line.slice(runIndent + 2));
  }
  const script = body.join('\n').trimEnd();
  assert.match(script, /set -euo pipefail/, `${name}: expected strict shell mode`);
  return script;
}

const fallbackScript = stepScript('Configure optional independent fallback provider');
const stripeScript = stepScript('Configure optional Stripe billing');
// Guard against the extractor silently picking up a different script.
assert.match(fallbackScript, /PI_FALLBACK_API_KEY/);
assert.match(stripeScript, /sk_test_\*\|rk_test_\*/);
assert.match(stripeScript, /api\.stripe\.com/);

// Stubs: no network, no wrangler. curl answers with an active recurring Price whose livemode is true for any
// bearer token containing "live", so the stub never decides a prefix question the shell's own `case` should
// decide; npx just records the call.
const dir = mkdtempSync(join(tmpdir(), 'pi-parity-'));
const stubs = join(dir, 'bin');
const calls = join(dir, 'calls.log');
spawnSync('mkdir', ['-p', stubs]);
const stub = (name, body) => { const p = join(stubs, name); writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); };
stub('curl', `echo "curl" >> "${calls}"
live=false; for a in "$@"; do case "$a" in *"Bearer "*live*) live=true ;; esac; done
printf '{"object":"price","active":true,"livemode":%s,"type":"recurring"}' "$live"`);
stub('npx', `echo "npx $1 $2 $3" >> "${calls}"; cat >/dev/null`);
const python = spawnSync('bash', ['-c', 'command -v python || command -v python3'], {encoding: 'utf8'}).stdout.trim();
assert.ok(python, 'python or python3 is required to run the extracted Stripe step');
stub('python', `exec "${python}" "$@"`);

const shellPath = `${stubs}:/usr/bin:/bin`;
// Abort (exit 97) unless the stubs are what bash would actually run.
const guard = `[[ "$(command -v curl)" == "${stubs}/curl" && "$(command -v npx)" == "${stubs}/npx" ]] || exit 97\n`;

function shellAccepts(script, env) {
  writeFileSync(calls, '');
  const r = spawnSync('bash', ['-c', guard + script], {env: {PATH: shellPath, ...env}, encoding: 'utf8'});
  assert.notEqual(r.status, 97, 'provider stubs were not first on PATH; refusing to run');
  assert.ok(r.status === 0 || r.status === 1, `unexpected shell exit ${r.status}: ${r.stderr}`);
  return {ok: r.status === 0, out: r.stdout + r.stderr, calls: readFileSync(calls, 'utf8')};
}

const CF = {CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a'};
const validatorAccepts = (env, topic) => !validateDeployConfiguration({...CF, ...env}).some(e => topic.test(e));
const FALLBACK_ERR = /fallback/i;
const STRIPE_ERR = /stripe/i;

function subsets(names) {
  return Array.from({length: 1 << names.length}, (_, mask) => names.filter((_, i) => mask & (1 << i)));
}

let compared = 0;
const seen = {fallback: new Set(), stripe: new Set()};
try {
  // Fallback: every presence combination, plus whitespace-only and the optional style alone.
  const fb = {PI_FALLBACK_API_KEY: 'k-canary', PI_FALLBACK_API_URL: 'https://fallback.invalid', PI_FALLBACK_MODEL: 'm'};
  const fallbackCases = subsets(Object.keys(fb)).map(names => Object.fromEntries(names.map(n => [n, fb[n]])));
  fallbackCases.push({PI_FALLBACK_API_KEY: ' ', PI_FALLBACK_API_URL: ' ', PI_FALLBACK_MODEL: ' '});
  fallbackCases.push({PI_FALLBACK_API_KEY: ' '});
  fallbackCases.push({PI_FALLBACK_API_STYLE: 'openai'});
  for (const env of fallbackCases) {
    const shell = shellAccepts(fallbackScript, env);
    assert.equal(validatorAccepts(env, FALLBACK_ERR), shell.ok, `fallback parity for ${JSON.stringify(Object.keys(env))}`);
    assert.doesNotMatch(shell.out, /canary/);
    seen.fallback.add(shell.ok);
    compared += 1;
  }

  // Stripe: every presence combination with valid values, then prefix variants on a complete set.
  const st = {PI_STRIPE_SECRET_KEY: 'sk_test_canary', PI_STRIPE_WEBHOOK_SECRET: 'whsec_canary', PI_STRIPE_PRICE_ID: 'price_canary'};
  const stripeCases = subsets(Object.keys(st)).map(names => Object.fromEntries(names.map(n => [n, st[n]])));
  for (const key of ['sk_test_canary', 'sk_live_canary', 'rk_test_canary', 'rk_live_canary', 'pk_live_canary', 'sk_canary', 'SK_TEST_canary', ' sk_test_canary', 'sk_test_', 'sk_testcanary', 'rk_canary', 'canary']) {
    stripeCases.push({...st, PI_STRIPE_SECRET_KEY: key});
  }
  for (const hook of ['whsec_', 'whsec', 'whse_canary', 'canary', ' whsec_canary']) stripeCases.push({...st, PI_STRIPE_WEBHOOK_SECRET: hook});
  for (const price of ['price_', 'price', 'pri_canary', 'prices', 'prod_canary', 'price_canary\n', ' price_canary', 'PRICE_canary']) stripeCases.push({...st, PI_STRIPE_PRICE_ID: price});
  stripeCases.push({PI_STRIPE_SECRET_KEY: ' ', PI_STRIPE_WEBHOOK_SECRET: ' ', PI_STRIPE_PRICE_ID: ' '});
  for (const env of stripeCases) {
    const shell = shellAccepts(stripeScript, env);
    const label = JSON.stringify(Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace(/canary/g, '*')])));
    assert.equal(validatorAccepts(env, STRIPE_ERR), shell.ok, `stripe parity for ${label}`);
    // A shell acceptance must have gone through the stubbed Price lookup, never a real provider.
    seen.stripe.add(shell.ok);
    if (shell.ok && Object.keys(env).length === 3) assert.match(shell.calls, /^curl$/m, `stripe accept without stubbed Price lookup for ${label}`);
    compared += 1;
  }
  // Not vacuous: each provider must have both accepted and refused cases.
  assert.deepEqual([...seen.fallback].sort(), [false, true]);
  assert.deepEqual([...seen.stripe].sort(), [false, true]);
} finally {
  rmSync(dir, {recursive: true, force: true});
}

console.log(`Validator/shell parity held for ${compared} fallback and Stripe cases (Cloudflare-required and live Stripe Price checks not covered).`);

// Guards the PI V1.02 PR Core workflow: the existing provider-free gates stay in place and in order,
// the shell/validator parity test runs, PR Core triggers when the deploy workflow's shell rules change,
// and nothing in PR Core can reach secrets, deploy or skip a failure. Text-based on purpose (no YAML
// dependency); it fails loudly if the layout it relies on changes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../../.github/workflows/pi-v102-pr-core.yml', import.meta.url));
const text = readFileSync(path, 'utf8');
const lines = text.split('\n');

// Trigger paths: the original three plus the deploy workflow whose shell rules the parity test reads.
const pathsAt = lines.findIndex(line => line.trim() === 'paths:');
assert.ok(pathsAt > 0, 'pull_request paths block missing');
const paths = [];
for (let i = pathsAt + 1; i < lines.length && lines[i].trim().startsWith('- '); i += 1) paths.push(lines[i].trim().slice(2));
for (const p of ["'worker/**'", "'package.json'", "'.github/workflows/pi-v102-pr-core.yml'", "'.github/workflows/pi-chat-worker.yml'"]) {
  assert.ok(paths.includes(p), `PR Core trigger path missing: ${p}`);
}
assert.match(text, /^on:\n {2}pull_request:\n {4}branches: \[main\]/m, 'PR Core must stay a pull_request gate on main');
assert.match(text, /^permissions:\n {2}contents: read$/m, 'PR Core permissions must stay read-only');
assert.match(text, /^ {4}timeout-minutes: 10$/m, 'PR Core timeout changed');

// Existing gates remain, in order, followed by the parity step.
const steps = [];
for (let i = 0; i < lines.length; i += 1) {
  const m = lines[i].match(/^ {6}- (?:name: (.*)|uses: (.*))$/);
  if (!m) continue;
  const block = [lines[i]];
  for (let j = i + 1; j < lines.length && !/^ {6}- /.test(lines[j]); j += 1) block.push(lines[j]);
  steps.push({ title: m[1] || m[2], body: block.join('\n') });
}
const titles = steps.map(s => s.title);
assert.deepEqual(titles, [
  'actions/checkout@v5',
  'actions/setup-node@v5',
  'Install dependencies',
  'Run V1.02 core regression suite',
  'Pre-deploy configuration validation (provider-free)',
  'Deploy configuration shell/validator parity (provider-free)'
], 'PR Core steps changed, removed or reordered');
assert.match(steps[1].body, /node-version: 22/);
assert.match(steps[3].body, /run: npm run test:v1\.02$/m);
assert.match(steps[4].body, /working-directory: worker\n {8}run: node scripts\/validate-deploy-configuration-test\.mjs$/m);
assert.match(steps[5].body, /working-directory: worker/);
assert.match(steps[5].body, /^ {10}node scripts\/validate-deploy-configuration-parity-test\.mjs$/m);
assert.ok(existsSync(fileURLToPath(new URL('./validate-deploy-configuration-parity-test.mjs', import.meta.url))), 'parity test file missing');

// Nothing in PR Core may weaken or bypass a failure, read secrets, or deploy.
for (const banned of [/continue-on-error/, /secrets\./, /wrangler/, /\|\| *true/, /^ {8}if:/m, /pull_request_target/]) {
  assert.doesNotMatch(text, banned, `PR Core must not contain ${banned}`);
}

console.log('PR Core workflow keeps its provider-free gates and runs the deploy-configuration parity test.');

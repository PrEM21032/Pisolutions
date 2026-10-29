#!/usr/bin/env node
// PI Investment Lab — end-to-end read-only demonstration.
//
//   node pi/investment-lab/demo.mjs [--out DIR]   offline: synthetic MCP fixture over real HTTP
//   node pi/investment-lab/demo.mjs --probe       unauthenticated reachability probe of the live endpoint
//   ROBINHOOD_MCP_ACCESS_TOKEN=... node pi/investment-lab/demo.mjs --live [--out DIR]
//
// --live uses an OAuth access token the OWNER obtained themselves; this script never logs in,
// never stores the token, and never prints it. It inspects read-only and simulates trades locally.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createMcpClient, McpTransportError } from './mcp-client.mjs';
import { createPermissionGateway } from './permission-gateway.mjs';
import { runInvestmentMission } from './orchestrator.mjs';
import { startFixtureServer, FIXTURE_ACCOUNT_NUMBER } from './fixture-mcp-server.mjs';

export const LIVE_ENDPOINT = process.env.ROBINHOOD_MCP_URL || 'https://agent.robinhood.com/mcp/trading';

export const DEMO_CONSTRAINTS = Object.freeze({
  watchlist: ['SCHD'],
  proposedOrders: [
    { side: 'buy', symbol: 'SCHD', quantity: 10, type: 'market' },
    { side: 'sell', symbol: 'AAPL', quantity: 5, type: 'market' },
    { side: 'buy', symbol: 'NVDA', quantity: 20, type: 'market' },
    { side: 'buy', symbol: 'VTI', quantity: 1000, type: 'market' }
  ],
  requestLiveExecution: true,
  ownerApproval: true
});

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function writeOutputs(outDir, result) {
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'investment-lab-report.md');
  const jsonPath = path.join(outDir, 'investment-lab-run.json');
  fs.writeFileSync(reportPath, `${result.report}\n`);
  const { report, ...rest } = result;
  fs.writeFileSync(jsonPath, `${JSON.stringify(rest, null, 2)}\n`);
  return { reportPath, jsonPath };
}

export async function runFixtureDemo({ outDir = null, responseMode = 'json' } = {}) {
  const token = `fixture-only-${crypto.randomBytes(12).toString('hex')}`;
  const fixture = await startFixtureServer({ token, responseMode });
  try {
    const client = createMcpClient({ endpoint: fixture.url, getAccessToken: async () => token });
    const gateway = createPermissionGateway({ client, secretCanaries: [token] });
    const result = await runInvestmentMission({ gateway, provenance: 'synthetic-fixture', constraints: DEMO_CONSTRAINTS, missionId: `lab_demo_${Date.now()}` });
    const serialized = JSON.stringify(result);
    const leakage = {
      tokenInOutput: serialized.includes(token),
      rawAccountNumberInOutput: serialized.includes(FIXTURE_ACCOUNT_NUMBER)
    };
    const serverCalls = fixture.calls.map(call => call.name);
    const files = outDir ? writeOutputs(outDir, { ...result, demoEvidence: { serverCalls, leakage } }) : null;
    return { result, serverCalls, leakage, files };
  } finally {
    await fixture.close();
  }
}

async function probe() {
  const client = createMcpClient({ endpoint: LIVE_ENDPOINT, timeoutMs: 10_000 });
  try {
    await client.initialize();
    return { endpoint: LIVE_ENDPOINT, reachable: true, outcome: 'initialized_without_credentials_unexpected' };
  } catch (error) {
    if (error instanceof McpTransportError && error.code === 'unauthorized') return { endpoint: LIVE_ENDPOINT, reachable: true, outcome: 'auth_required_as_expected', detail: error.detail };
    return { endpoint: LIVE_ENDPOINT, reachable: false, outcome: error?.code || 'error', detail: error?.detail || null };
  }
}

async function live(outDir) {
  const token = process.env.ROBINHOOD_MCP_ACCESS_TOKEN;
  if (!token) return { ok: false, reason: 'ROBINHOOD_MCP_ACCESS_TOKEN not set; the owner must complete Robinhood OAuth and supply the token out-of-band.' };
  const client = createMcpClient({ endpoint: LIVE_ENDPOINT, getAccessToken: async () => token });
  const gateway = createPermissionGateway({ client, secretCanaries: [token] });
  const result = await runInvestmentMission({ gateway, provenance: 'live-robinhood-mcp', constraints: { watchlist: [], proposedOrders: [] } });
  if (JSON.stringify(result).includes(token)) throw new Error('token_leak_detected_output_suppressed');
  const files = outDir ? writeOutputs(outDir, result) : null;
  return { ok: result.ok, files, verification: result.verification?.result, stoppedAt: result.stoppedAt || null, problems: result.research?.problems };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const outDir = arg('--out');
  try {
    if (process.argv.includes('--probe')) {
      console.log(JSON.stringify(await probe(), null, 2));
    } else if (process.argv.includes('--live')) {
      console.log(JSON.stringify(await live(outDir), null, 2));
    } else {
      const { result, serverCalls, leakage, files } = await runFixtureDemo({ outDir });
      console.log(result.report);
      console.log('\n---');
      console.log(JSON.stringify({ ok: result.ok, provenance: result.provenance, verification: result.verification.result, serverCalls, leakage, trace: result.trace, files }, null, 2));
      if (!result.ok || leakage.tokenInOutput || leakage.rawAccountNumberInOutput) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error?.code || error?.message || 'unknown' }));
    process.exitCode = 1;
  }
}

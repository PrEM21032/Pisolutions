// PI Investment Lab — read-only permission gateway (Rama/Durga boundary).
// The ONLY component that holds the MCP client. Agents receive `inspect(capability, args)`
// and nothing else: no raw tool names, no arbitrary tool calls, no credentials,
// no real account identifiers. Deny-by-default; a tool must pass every check below.

import { normalizeToolEvidence } from '../tool-evidence.mjs';

export const READ_CAPABILITIES = Object.freeze(['accounts', 'portfolio', 'positions', 'quotes', 'historicals']);

// Any of these tokens in a tool name blocks it, regardless of annotations or owner mapping.
export const DENY_TOKENS = Object.freeze(new Set([
  'order', 'orders', 'trade', 'trades', 'trading', 'buy', 'sell', 'place', 'submit', 'cancel', 'replace', 'modify',
  'transfer', 'transfers', 'deposit', 'deposits', 'withdraw', 'withdrawal', 'withdrawals', 'fund', 'funds', 'funding',
  'ach', 'wire', 'margin', 'borrow', 'lend', 'loan', 'card', 'spend', 'pay', 'payment', 'payments', 'approve', 'approval',
  'enable', 'disable', 'create', 'update', 'delete', 'remove', 'set', 'close', 'exercise', 'convert', 'stake', 'unstake',
  'send', 'execute', 'link', 'unlink', 'login', 'logout', 'auth', 'oauth', 'token', 'tokens', 'credential', 'credentials',
  'password', 'bank', 'recurring', 'invest', 'rebalance', 'liquidate', 'short', 'option', 'options'
]));
const READ_VERBS = new Set(['get', 'list', 'search', 'fetch', 'read', 'view', 'lookup', 'describe', 'show', 'query']);
const CAPABILITY_TOKENS = Object.freeze([
  ['positions', ['position', 'positions', 'holding', 'holdings']],
  ['quotes', ['quote', 'quotes']],
  ['historicals', ['historical', 'historicals', 'candles', 'bars']],
  ['portfolio', ['portfolio', 'portfolios', 'balance', 'balances', 'equity']],
  ['accounts', ['account', 'accounts']]
]);
const FORBIDDEN_ARG_KEYS = /^(?:side|qty|quantity|shares|notional|amount|price|limit_?price|stop_?price|time_?in_?force|order_?type|leverage|margin)$/i;
const SECRET_KEYS = /token|secret|password|passwd|authorization|cookie|api[_-]?key|ssn|social_?security|tax_?id|routing|bank_?account|email|phone|address|birth|dob/i;
const ACCOUNT_KEYS = /^(?:account|account_?(?:number|num|no|id)|accountnumber|accountid|rhs_?account_?number)$/i;
const MAX_RESULT_CHARS = 1_000_000;

export function tokenizeToolName(name = '') {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function classifyTool(tool = {}, { toolMap = {} } = {}) {
  const name = String(tool?.name || '');
  const tokens = tokenizeToolName(name);
  const annotations = tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {};
  const denied = tokens.find(token => DENY_TOKENS.has(token));
  if (!name) return { name, decision: 'deny', reason: 'unnamed_tool', capability: null };
  if (denied) return { name, decision: 'deny', reason: `deny_token:${denied}`, capability: null };
  if (annotations.destructiveHint === true) return { name, decision: 'deny', reason: 'annotation_destructive', capability: null };
  if (annotations.readOnlyHint === false) return { name, decision: 'deny', reason: 'annotation_not_read_only', capability: null };
  const readIntent = READ_VERBS.has(tokens[0]) || annotations.readOnlyHint === true;
  if (!readIntent) return { name, decision: 'deny', reason: 'no_read_intent', capability: null };
  const mapped = Object.entries(toolMap).find(([, toolName]) => toolName === name)?.[0] || null;
  if (mapped && !READ_CAPABILITIES.includes(mapped)) return { name, decision: 'deny', reason: 'owner_map_unknown_capability', capability: null };
  const inferred = CAPABILITY_TOKENS.find(([, words]) => words.some(word => tokens.includes(word)))?.[0] || null;
  const capability = mapped || inferred;
  if (!capability) return { name, decision: 'deny', reason: 'not_in_read_capability_allowlist', capability: null };
  return { name, decision: 'allow', reason: mapped ? 'owner_mapped_read_tool' : 'inferred_read_tool', capability };
}

function extractPayload(result) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'empty_tool_result' };
  if (result.isError) return { ok: false, reason: 'tool_reported_error' };
  if (result.structuredContent && typeof result.structuredContent === 'object') return { ok: true, data: result.structuredContent };
  const texts = (Array.isArray(result.content) ? result.content : []).filter(item => item?.type === 'text').map(item => String(item.text || ''));
  const joined = texts.join('\n');
  if (joined.length > MAX_RESULT_CHARS) return { ok: false, reason: 'tool_result_too_large' };
  try { return { ok: true, data: JSON.parse(joined) }; } catch { return { ok: true, data: { text: joined } }; }
}

export function createPermissionGateway({ client, toolMap = {}, maxCalls = 50, secretCanaries = [], now = () => Date.now() } = {}) {
  if (!client || typeof client.callTool !== 'function') throw new Error('mcp_client_required');
  const routes = new Map();
  const accountRefs = new Map();
  const refToAccount = new Map();
  const audit = [];
  let discovery = null;
  let calls = 0;
  const canaries = secretCanaries.filter(value => typeof value === 'string' && value.length >= 8);

  function refFor(value) {
    const raw = String(value);
    if (!accountRefs.has(raw)) {
      const ref = `acct_ref_${accountRefs.size + 1}`;
      accountRefs.set(raw, ref);
      refToAccount.set(ref, raw);
    }
    return accountRefs.get(raw);
  }

  function scrubString(value) {
    let out = value;
    for (const canary of canaries) if (out.includes(canary)) out = out.split(canary).join('[REDACTED]');
    for (const [raw, ref] of accountRefs) if (raw.length >= 4 && out.includes(raw)) out = out.split(raw).join(ref);
    return out;
  }

  function sanitize(value, depth = 0) {
    if (depth > 12) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 1000).map(item => sanitize(item, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, inner] of Object.entries(value)) {
        if (ACCOUNT_KEYS.test(key) && (typeof inner === 'string' || typeof inner === 'number')) out[key] = refFor(inner);
        else if (SECRET_KEYS.test(key)) out[key] = '[REDACTED]';
        else out[key] = sanitize(inner, depth + 1);
      }
      return out;
    }
    return typeof value === 'string' ? scrubString(value) : value;
  }

  // Two passes: first collect account identifiers anywhere, then scrub every string.
  function sanitizeResult(data) { sanitize(data); return sanitize(data); }

  function translateArgs(args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: 'args_must_be_object' };
    const out = {};
    for (const [key, value] of Object.entries(args)) {
      if (FORBIDDEN_ARG_KEYS.test(key)) return { ok: false, reason: `forbidden_arg:${key}` };
      if (ACCOUNT_KEYS.test(key)) {
        if (!refToAccount.has(value)) return { ok: false, reason: 'unknown_account_ref' };
        out[key] = refToAccount.get(value);
      } else if (typeof value === 'string' && value.length > 200) return { ok: false, reason: 'arg_too_long' };
      else out[key] = value;
    }
    return { ok: true, args: out };
  }

  function record(entry) {
    const frozen = Object.freeze({ seq: audit.length + 1, at: new Date(now()).toISOString(), ...entry });
    audit.push(frozen);
    return frozen;
  }

  return Object.freeze({
    async connect() {
      const session = await client.initialize();
      const tools = await client.listTools();
      const classified = tools.map(tool => classifyTool(tool, { toolMap }));
      for (const entry of classified) {
        if (entry.decision === 'allow' && !routes.has(entry.capability)) routes.set(entry.capability, entry.name);
      }
      for (const [capability, name] of Object.entries(toolMap)) {
        const entry = classified.find(item => item.name === name);
        if (entry?.decision === 'allow') routes.set(capability, name);
      }
      discovery = Object.freeze({
        server: session.serverInfo,
        protocolVersion: session.protocolVersion,
        endpointHost: client.endpointHost,
        tools: classified.map(item => Object.freeze({ ...item })),
        routes: Object.freeze(Object.fromEntries(routes))
      });
      record({ type: 'discovery', decision: 'info', toolsSeen: tools.length, toolsAllowed: classified.filter(item => item.decision === 'allow').length });
      return discovery;
    },
    discovery() { return discovery; },
    capabilities() { return [...routes.keys()]; },
    auditLog() { return audit.map(entry => ({ ...entry })); },
    async inspect(capability, args = {}) {
      const started = now();
      if (!discovery) return { ok: false, reason: 'gateway_not_connected', entry: record({ type: 'inspect', capability, decision: 'deny', reason: 'gateway_not_connected' }) };
      if (!READ_CAPABILITIES.includes(capability)) return { ok: false, reason: 'capability_not_allowed', entry: record({ type: 'inspect', capability: String(capability), decision: 'deny', reason: 'capability_not_allowed' }) };
      const tool = routes.get(capability);
      if (!tool) return { ok: false, reason: 'no_read_tool_for_capability', entry: record({ type: 'inspect', capability, decision: 'deny', reason: 'no_read_tool_for_capability' }) };
      if (calls >= maxCalls) return { ok: false, reason: 'call_budget_exhausted', entry: record({ type: 'inspect', capability, tool, decision: 'deny', reason: 'call_budget_exhausted' }) };
      const translated = translateArgs(args);
      if (!translated.ok) return { ok: false, reason: translated.reason, entry: record({ type: 'inspect', capability, tool, decision: 'deny', reason: translated.reason }) };
      calls += 1;
      let payload;
      try {
        payload = extractPayload(await client.callTool(tool, translated.args));
      } catch (error) {
        const reason = `transport:${error?.code || 'unknown'}`;
        return { ok: false, reason, entry: record({ type: 'inspect', capability, tool, decision: 'allow', ok: false, reason, latencyMs: now() - started }) };
      }
      if (!payload.ok) return { ok: false, reason: payload.reason, entry: record({ type: 'inspect', capability, tool, decision: 'allow', ok: false, reason: payload.reason, latencyMs: now() - started }) };
      const data = sanitizeResult(payload.data);
      const observedAt = new Date(now()).toISOString();
      const evidence = normalizeToolEvidence({ tool, result: data, observedAt, confidence: 'probable', limitations: ['source-reported by MCP server; not independently audited'] });
      const entry = record({ type: 'inspect', capability, tool, decision: 'allow', ok: true, argKeys: Object.keys(args), latencyMs: now() - started });
      return { ok: true, capability, tool, data, observedAt, evidence, entry };
    }
  });
}

// Relay of the DAO switchboard. Programs and AI assistants call https://hub.<subdomain>.workers.dev/api or /mcp;
// the hub server (shared hosting in Russia, unreachable from data centers) collects the calls itself with
// POST /_pull and returns the answers with the next pull. Nothing is stored: calls live in memory for 25 s at most.
// One Durable Object ("main") holds the waiting calls, so every call and every pull meet in one place.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const FORWARD = ['authorization', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version'];
const CALL_WAIT = 25000;   // how long a caller waits for the hub
const PULL_WAIT = 20000;   // how long the hub's pull waits for a call
const BODY_MAX = 16384;
const QUEUE_MAX = 50;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sameSecret(given, expected) {
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export class Mailbox {
  constructor(state, env) {
    this.env = env;
    this.queue = [];          // calls not yet handed to the hub
    this.waiting = new Map(); // id -> resolve(answer)
    this.puller = null;       // resolve() of a pull waiting for calls
    this.lastPull = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    return url.pathname === '/_pull' ? this.pull(request, url) : this.call(request, url);
  }

  async call(request, url) {
    if (Date.now() - this.lastPull > 90000) return json({ ok: false, error: 'hub_offline' }, 503);
    if (this.queue.length >= QUEUE_MAX) return json({ ok: false, error: 'busy' }, 503);
    const body = request.method === 'POST' ? await request.text() : '';
    if (body.length > BODY_MAX) return json({ ok: false, error: 'too_large' }, 413);
    const headers = {};
    for (const h of FORWARD) { const v = request.headers.get(h); if (v) headers[h] = v; }
    const id = crypto.randomUUID();
    const answer = new Promise((resolve) => this.waiting.set(id, resolve));
    this.queue.push({ id, method: request.method, path: url.pathname, headers, body });
    this.wake();
    const result = await Promise.race([answer, sleep(CALL_WAIT).then(() => null)]);
    this.waiting.delete(id);
    this.queue = this.queue.filter((c) => c.id !== id);
    if (!result) return json({ ok: false, error: 'hub_timeout' }, 504);
    const out = { 'cache-control': 'no-store', ...CORS };
    if (result.type) out['content-type'] = result.type;
    for (const [k, v] of Object.entries(result.headers || {})) if (/^(mcp-session-id|allow)$/i.test(k)) out[k] = String(v);
    return new Response(result.status === 202 || result.status === 204 ? null : (result.body ?? ''), { status: result.status || 200, headers: out });
  }

  wake() { if (this.puller) { const r = this.puller; this.puller = null; r(); } }

  async pull(request, url) {
    const auth = request.headers.get('authorization') || '';
    if (request.method !== 'POST' || !(await sameSecret(auth.replace(/^Bearer\s+/i, ''), this.env.RELAY_SECRET))) return json({ ok: false }, 401);
    this.lastPull = Date.now();
    let replies = [];
    try { replies = (await request.json()).replies || []; } catch (e) { replies = []; }
    for (const r of replies) { const resolve = this.waiting.get(r && r.id); if (resolve) resolve(r); }
    if (!this.queue.length && url.searchParams.get('wait') !== '0') {
      if (this.puller) this.puller();   // an older pull returns empty
      await Promise.race([new Promise((r) => { this.puller = r; }), sleep(PULL_WAIT)]);
      this.puller = null;
      this.lastPull = Date.now();
    }
    return json({ ok: true, requests: this.queue.splice(0, 10) });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/') return json({ ok: true, name: 'kommutator relay', endpoints: ['/api', '/mcp'] });
    if (!/^\/(api|mcp)(\/[A-Za-z0-9_-]{1,64})?$/.test(url.pathname) && url.pathname !== '/_pull') return json({ ok: false, error: 'not_found' }, 404);
    return env.BOX.get(env.BOX.idFromName('main')).fetch(request);
  },
};

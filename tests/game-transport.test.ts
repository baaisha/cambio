import test from 'node:test';
import assert from 'node:assert/strict';
import { GameTransport } from '../lib/game-transport.ts';
import { gameRelayPath } from '../lib/relay-routes.ts';
import { verifiedRelayIp } from '../lib/relay-identity.ts';
import { generateKeyPair, SignJWT } from 'jose';

const healthy = () => Response.json({ ok: true, service: 'cambio' });
test('direct is preferred; blocked direct access selects relay once before any room write', async () => {
  const calls: string[] = [];
  const transport = new GameTransport('https://worker.example', async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (String(url).startsWith('https://worker')) throw new TypeError('Network failed');
    return String(url).endsWith('/health') ? healthy() : Response.json({ code: 'AB12' });
  });
  await Promise.all([transport.ensure(), transport.ensure()]);
  await transport.request('/rooms', { method: 'POST', body: '{"name":"Alex"}' });
  assert.deepEqual(calls, ['GET https://worker.example/health', 'GET /api/game/health', 'POST /api/game/rooms']);
  assert.equal(transport.socketUrl('AB12', 'https://cambio.example'), 'wss://cambio.example/api/game/rooms/AB12/ws');
});
test('working direct access stays direct; a lost POST is not sent twice and application errors do not trigger fallback', async () => {
  let writes = 0;
  const transport = new GameTransport('https://worker.example', async (url, init) => {
    if (String(url).endsWith('/health')) return healthy();
    if (init?.method === 'POST') { writes++; throw new TypeError('Response lost'); }
    return Response.json({ error: 'Not found' }, { status: 404 });
  });
  await transport.ensure(); assert.equal(transport.route, 'direct');
  assert.equal((await transport.request('/rooms/AB12/join')).status, 404); assert.equal(transport.route, 'direct');
  await assert.rejects(transport.request('/rooms', { method: 'POST' }), /may have reached/);
  assert.equal(writes, 1); assert.equal(transport.route, 'relay');
});
test('read failures retry over relay, caller cancellation does not, and failed probes can recover', async () => {
  let failed = true;
  const transport = new GameTransport('https://worker.example', async (url) => {
    if (String(url).endsWith('/health')) return healthy();
    if (String(url).startsWith('https:') || failed) throw new TypeError('Network failed');
    return Response.json({ rooms: [] });
  });
  await assert.rejects(transport.request('/rooms'));
  failed = false;
  assert.equal((await transport.request('/rooms')).status, 200); assert.equal(transport.route, 'relay');
  const abort = new AbortController(); abort.abort();
  const cancelled = new GameTransport('https://worker.example', async (url, init) => {
    if (String(url).endsWith('/health')) return healthy();
    init?.signal?.throwIfAborted(); return healthy();
  });
  await assert.rejects(cancelled.request('/rooms', { signal: abort.signal })); assert.equal(cancelled.route, 'direct');
});
test('relay paths are restricted to the existing game API', () => {
  assert.equal(gameRelayPath(['rooms'], 'POST'), '/rooms');
  assert.equal(gameRelayPath(['rooms', 'AB12', 'ws'], 'GET'), '/rooms/AB12/ws');
  for (const parts of [['https:', 'evil.example'], ['rooms', '..', 'ws'], ['rooms', 'AB12', 'remove'], ['health', 'extra']]) assert.equal(gameRelayPath(parts, 'GET'), null);
  assert.equal(gameRelayPath(['rooms', 'AB12', 'ws'], 'POST'), null);
});
test('forwarded IP requires a valid, unexpired signature from this production Vercel project', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const issuer = 'https://oidc.vercel.com/shreyasjain';
  const token = (subject = 'owner:shreyasjain:project:cambio:environment:production', exp = '2m') => new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience('https://vercel.com/shreyasjain').setSubject(subject).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  const headers = new Headers({ 'x-cambio-client-ip': '192.0.2.1' });
  assert.equal(await verifiedRelayIp(headers), null);
  headers.set('x-cambio-relay-token', await token());
  assert.equal(await verifiedRelayIp(headers, async () => publicKey), '192.0.2.1');
  headers.set('x-cambio-relay-token', await token('owner:shreyasjain:project:other:environment:production'));
  await assert.rejects(verifiedRelayIp(headers, async () => publicKey));
  headers.set('x-cambio-relay-token', await token(undefined, '-1h'));
  await assert.rejects(verifiedRelayIp(headers, async () => publicKey));
  headers.set('x-cambio-relay-token', 'forged'); await assert.rejects(verifiedRelayIp(headers));
});

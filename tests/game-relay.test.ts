import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { attachGameRelay } from '../lib/game-socket-relay.ts';

test('game relay buffers initial auth, preserves private messages and auth close codes, and rotates cleanly', async () => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await Promise.all([once(upstream, 'listening'), once(relay, 'listening')]);
  const a = upstream.address(), b = relay.address(); assert.ok(a && typeof a === 'object' && b && typeof b === 'object');
  upstream.on('connection', socket => socket.on('message', data => {
    if (data.toString() === 'invalid-auth') socket.close(4003, 'Your seat could not be authenticated.');
    else socket.send(data.toString());
  }));
  relay.on('connection', (client, request) => attachGameRelay(client, `ws://127.0.0.1:${a.port}`, undefined, request.url === '/rotate' ? 100 : 30000));
  const connect = (path = '') => new WebSocket(`ws://127.0.0.1:${b.port}${path}`);
  const client = connect();
  try {
    await once(client, 'open');
    const auth = JSON.stringify({ type: 'auth', token: 'private-seat-token' });
    const reply = once(client, 'message'); client.send(auth);
    assert.equal((await reply)[0].toString(), auth);
    const pong = once(client, 'message'); client.send('ping'); assert.equal((await pong)[0].toString(), 'ping');
    const denied = once(client, 'close'); client.send('invalid-auth'); assert.equal((await denied)[0], 4003);
    const rotating = connect('/rotate'); await once(rotating, 'open');
    assert.equal((await once(rotating, 'close'))[0], 1012);
  } finally {
    client.terminate();
    for (const server of [relay, upstream]) { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

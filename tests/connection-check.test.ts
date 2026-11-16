import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { diagnosticNonce } from '../lib/connection-check.ts';
import { attachDiagnosticRelay } from '../lib/diagnostic-relay.ts';

test('diagnostics accept only bounded ping nonces, never arbitrary traffic or target URLs', () => {
  assert.equal(diagnosticNonce('{"type":"ping","id":"abc-123"}'), 'abc-123');
  for (const input of ['null', '{}', '{', '{"type":"draw","id":"a"}', '{"type":"ping","id":"https://example.com"}', JSON.stringify({ type: 'ping', id: 'a'.repeat(65) }), ' '.repeat(257)]) assert.equal(diagnosticNonce(input), null);
});

test('relay forwards echoes to the upstream, rejects game actions, and cleans up both sockets', async () => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await Promise.all([once(upstream, 'listening'), once(relay, 'listening')]);
  const address = upstream.address(); const relayAddress = relay.address();
  assert.ok(typeof address === 'object' && address); assert.ok(typeof relayAddress === 'object' && relayAddress);
  let received = '';
  upstream.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'ready' }));
    socket.on('message', data => {
      received = data.toString();
      socket.send(JSON.stringify({ type: 'echo', id: JSON.parse(received).id, workerTime: 123 }));
    });
  });
  relay.on('connection', client => attachDiagnosticRelay(client, `ws://127.0.0.1:${address.port}`));
  const client = new WebSocket(`ws://127.0.0.1:${relayAddress.port}`);
  try {
    const ready = await once(client, 'message'); assert.equal(JSON.parse(ready[0].toString()).type, 'ready');
    const echo = once(client, 'message');
    client.send(JSON.stringify({ type: 'ping', id: 'a' }));
    assert.deepEqual(JSON.parse((await echo)[0].toString()), { type: 'echo', id: 'a', workerTime: 123 });
    assert.equal(JSON.parse(received).id, 'a');
    const closed = once(client, 'close');
    client.send(JSON.stringify({ type: 'draw' }));
    assert.equal((await closed)[0], 1008);
    assert.equal(JSON.parse(received).type, 'ping');
  } finally {
    client.terminate();
    for (const server of [relay, upstream]) { for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

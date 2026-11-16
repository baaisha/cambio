// Network-only probe. No browser, rooms, seat tokens, or game state.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = process.argv[2] || 'https://cambio.shrysjain.me';
const worker = process.env.GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev';
async function echo(url, expectedVia) {
  const socket = new WebSocket(url, { headers: { Origin: base }, handshakeTimeout: 12000 });
  await new Promise((resolve, reject) => {
    let count = 0;
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error(`Echo timeout: ${url}`)); }, 15000);
    const stop = error => { clearTimeout(timeout); socket.close(); error ? reject(error) : resolve(); };
    socket.on('error', stop);
    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ready') { assert.equal(message.via, expectedVia); socket.send(JSON.stringify({ type: 'ping', id: 'probe-0' })); }
        if (message.type === 'error') throw new Error(message.error);
        if (message.type === 'echo') {
          assert.equal(message.id, `probe-${count}`); assert.equal(typeof message.workerTime, 'number');
          if (++count === 3) stop(); else socket.send(JSON.stringify({ type: 'ping', id: `probe-${count}` }));
        }
      } catch (error) { stop(error); }
    });
  });
}
const direct = await fetch(worker + '/health', { headers: { Origin: base }, signal: AbortSignal.timeout(12000) });
assert.equal(direct.headers.get('access-control-allow-origin'), base);
assert.equal((await direct.json()).ok, true);
const relay = await fetch(base + '/api/connection-check/http', { signal: AbortSignal.timeout(12000) });
assert.equal(relay.status, 200); assert.equal((await relay.json()).via, 'vercel');
await echo(worker.replace(/^http/, 'ws') + '/diagnostics/echo', 'cloudflare-worker');
await echo(base.replace(/^http/, 'ws') + '/api/connection-check/ws', 'vercel');
console.log('PASS: direct health, Vercel health relay, direct Worker echoes, and end-to-end Vercel → Worker WebSocket echoes');

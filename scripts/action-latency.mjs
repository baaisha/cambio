// Isolated rooms only. Measures action send → ack and the following authoritative state.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const worker = process.env.GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev';
const site = process.env.GAME_SITE || 'https://cambio.shrysjain.me';
const mode = process.argv[2] || 'direct';
const base = mode === 'relay' ? site + '/api/game' : worker;
const pause = ms => new Promise(r => setTimeout(r, ms));
const clients = [], samples = [];
async function post(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await r.json(); assert.equal(r.status, 200, data.error); return data; }
async function connect(seat) {
  const client = { seat, state: null, pending: null, ws: new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${seat.code}/ws`, { headers: { Origin: site } }) };
  clients.push(client);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Auth timeout')), 10000);
    client.ws.on('open', () => client.ws.send(JSON.stringify({ type: 'auth', ...seat })));
    client.ws.on('error', reject);
    client.ws.on('message', raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === 'error') { client.pending?.reject(new Error(data.error)); client.pending = null; }
      if (data.type === 'ack' && data.id === client.pending?.id) client.pending.ackMs = performance.now() - client.pending.started;
      if (data.type === 'state') {
        client.state = data.state; clearTimeout(timeout); resolve();
        if (client.pending?.ackMs !== undefined) {
          const pending = client.pending; client.pending = null;
          const sample = { action: pending.action, ackMs: Math.round(pending.ackMs), stateMs: Math.round(performance.now() - pending.started) };
          samples.push(sample); pending.resolve();
        }
      }
    });
  });
  return client;
}
async function act(client, action) {
  await new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), started = performance.now();
    const timeout = setTimeout(() => reject(new Error('Action timeout')), 10000);
    client.pending = { id, action: action.type, started, resolve: () => { clearTimeout(timeout); resolve(); }, reject: e => { clearTimeout(timeout); reject(e); } };
    client.ws.send(JSON.stringify({ type: 'action', id, action, version: client.state.version }));
  });
  const version = client.state.version;
  const deadline = Date.now() + 10000;
  while (clients.some(c => !c.state || c.state.version < version)) {
    if (Date.now() > deadline) throw new Error('Other player state did not catch up');
    await pause(10);
  }
  const version = client.state.version;
  const deadline = Date.now() + 10000;
  while (clients.some(c => !c.state || c.state.version < version)) {
    if (Date.now() > deadline) throw new Error('Peer state synchronization timeout');
    await pause(10);
  }
  await pause(80);
}
try {
  const host = await connect(await post('/rooms', { name: 'Latency check host' }));
  const friend = await connect(await post(`/rooms/${host.seat.code}/join`, { name: 'Latency check friend' }));
  for (const c of clients) await act(c, { type: 'ready' });
  await act(host, { type: 'start' });
  for (const c of clients) for (const slot of [2, 3]) { await act(c, { type: 'flip-initial', slot }); await act(c, { type: 'flip-initial', slot }); }
  for (let i = 0; i < 6; i++) {
    const active = clients.find(c => c.seat.playerId === host.state.activeId);
    await act(active, { type: 'draw' }); await act(active, { type: 'discard' });
    if (active.state.power) await act(active, { type: 'skip-power' });
  }
  const sorted = samples.map(s => s.stateMs).sort((a, b) => a-b);
  console.log(JSON.stringify({ mode, count: samples.length, medianStateMs: sorted[Math.floor(sorted.length/2)], p95StateMs: sorted[Math.ceil(sorted.length*.95)-1], meanStateMs: Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length), samples }));
} finally { for (const c of clients) c.ws.close(); }

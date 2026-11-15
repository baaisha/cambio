// Real network check against `npm run dev:api`. No browser automation or fake server state.
import assert from 'node:assert/strict';

const base = process.env.GAME_SERVER || 'http://127.0.0.1:8787';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 10000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for server state.'); await pause(15); }
}
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:3000' }, body: JSON.stringify(body) });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
async function connect(seat) {
  const client = { seat, ws: new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${seat.code}/ws`), state: null, acks: new Set(), errors: [] };
  client.ws.onopen = () => client.ws.send(JSON.stringify({ type: 'auth', ...seat }));
  client.ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') client.state = message.state;
    if (message.type === 'ack') client.acks.add(message.id);
    if (message.type === 'error') client.errors.push(message.error);
  };
  await until(() => client.state);
  return client;
}
async function action(client, command) {
  const id = crypto.randomUUID(), oldErrors = client.errors.length;
  client.ws.send(JSON.stringify({ type: 'action', id, version: client.state.version, action: command }));
  await until(() => client.acks.has(id) || client.errors.length > oldErrors);
  assert.equal(client.errors.length, oldErrors, client.errors.at(-1));
  // Exercise human-speed play rather than intentionally tripping the abuse limit.
  await pause(45);
}
const clients = [];
try {
  const a = await connect(await post('/rooms', { name: 'Spectator host' })); clients.push(a);
  const b = await connect(await post(`/rooms/${a.seat.code}/join`, { name: 'Original friend' })); clients.push(b);
  for (const c of clients) await action(c, { type: 'ready' });
  await action(a, { type: 'start' });
  const watcher = await connect(await post(`/rooms/${a.seat.code}/join`, { name: 'Queued friend' })); clients.push(watcher);
  const observer = await connect(await post(`/rooms/${a.seat.code}/join`, { name: 'Just watching' })); clients.push(observer);
  assert.equal(watcher.state.yourRole, 'spectator');
  await action(observer, { type: 'queue-seat', queued: false });
  await action(a, { type: 'reveal-initial' });
  await until(() => watcher.state.players[0].hand[2]?.peekedBy);
  assert.ok(watcher.state.players.every(p => p.initialCards === null && p.hand.every(h => !h?.face)));
  watcher.ws.send(JSON.stringify({type:'action',id:crypto.randomUUID(),action:{type:'end-game'}}));
  await until(() => watcher.errors.length);
  assert.match(watcher.errors[0], /seat/);
  for (const c of [a,b]) { if(c===b) await action(c,{type:'reveal-initial'}); await action(c,{type:'close-initial'}); }
  await until(() => a.state.phase === 'playing');
  const active = [a,b].find(c => c.seat.playerId === a.state.activeId);
  await action(active, {type:'draw'});
  await until(() => watcher.state.hasDrawn);
  assert.equal(watcher.state.drawn, null); assert.equal(watcher.state.power,null);
  await action(a,{type:'end-game'});
  await until(() => watcher.state.phase === 'finished');
  assert.equal(watcher.state.yourRole,'player');
  assert.equal(watcher.state.players.length,3);
  assert.equal(watcher.state.players.find(p=>p.id===watcher.seat.playerId).score,null);
  assert.equal(watcher.state.session.players.length,2);
  assert.equal(observer.state.yourRole,'spectator');
  const previousScores = watcher.state.results;
  await action(b, {type:'spectate'});
  await until(()=>b.state.yourRole==='spectator');
  assert.equal(b.state.spectators.find(p=>p.id===b.seat.playerId).queued,false);
  assert.deepEqual(b.state.results,previousScores);
  await action(observer,{type:'queue-seat',queued:true});
  await until(()=>observer.state.yourRole==='player');
  const rejoined = await connect(watcher.seat); clients.push(rejoined);
  assert.equal(rejoined.state.yourRole,'player');
  await action(a,{type:'ready'}); await action(observer,{type:'ready'});
  assert.equal(a.state.phase,'finished');
  await action(rejoined,{type:'ready'});
  await until(()=>rejoined.state.phase==='peek' && b.state.phase==='peek');
  await action(rejoined,{type:'reveal-initial'});
  await until(()=>b.state.players.find(p=>p.id===rejoined.seat.playerId)?.hand[2]?.peekedBy);
  assert.equal(rejoined.state.players.find(p=>p.id===rejoined.seat.playerId).hand.filter(h=>h?.face).length,2);
  assert.ok(b.state.players.every(p=>p.hand.every(h=>!h?.face)));
  await action(a,{type:'end-game'});
  await until(()=>a.state.phase==='finished');
  await action(b,{type:'queue-seat',queued:true});
  await until(()=>b.state.yourRole==='player');
  await action(a,{type:'spectate'});
  await until(()=>a.state.yourRole==='spectator');
  assert.notEqual(a.state.hostId,a.seat.playerId);
  assert.ok(a.state.players.some(p=>p.id===a.state.hostId));
  console.log('PASS: live spectator privacy, action rejection, opt-out, automatic seating, reconnect credentials, scoring, seat-to-spectator switching, host transfer, and ready-gated rematch');
} finally { for (const c of clients) c.ws.close(); }

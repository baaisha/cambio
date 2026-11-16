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
const guestToken = crypto.randomUUID() + crypto.randomUUID();
try {
  const a = await connect(await post('/rooms', { name: 'Session identity host' })); clients.push(a);
  const oldSeat = await post(`/rooms/${a.seat.code}/join`, { name: 'Session friend', guestToken });
  const b = await connect({ ...oldSeat, guestToken }); clients.push(b);
  for (const c of [a,b]) await action(c,{type:'ready'});
  await action(a,{type:'start'}); await action(a,{type:'end-game'});
  await until(()=>a.state.phase==='finished');
  const original = structuredClone(a.state.session.players.find(p=>p.memberIds.includes(oldSeat.playerId)));
  assert.ok(original); assert.equal(original.games,1);
  b.ws.close(); await until(()=>!a.state.connectedIds.includes(oldSeat.playerId));
  await action(a,{type:'remove',playerId:oldSeat.playerId});
  const renewedSeat = await post(`/rooms/${a.seat.code}/join`, { name: 'Renamed session friend', guestToken });
  const returned = await connect({ ...renewedSeat, guestToken }); clients.push(returned);
  const stats = returned.state.session.players.find(p=>p.memberIds.includes(renewedSeat.playerId));
  assert.equal(stats.id,original.id); assert.equal(stats.points,original.points); assert.equal(stats.games,1);
  assert.equal(stats.name,'Renamed session friend'); assert.equal(returned.state.session.players.length,2);
  const denied = new WebSocket(`${base.replace(/^http/,'ws')}/rooms/${oldSeat.code}/ws`);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{denied.close();reject(new Error('Revocation check timeout'));},8000);
    denied.onopen=()=>denied.send(JSON.stringify({type:'auth',...oldSeat,guestToken}));
    denied.onclose=e=>{clearTimeout(timer);assert.equal(e.code,4003);resolve();};
    denied.onerror=reject;
  });
  await action(a,{type:'ready'}); await action(returned,{type:'ready'});
  await until(()=>a.state.phase==='peek');
  await action(a,{type:'end-game'}); await until(()=>a.state.phase==='finished');
  const twoGames = a.state.session.players.find(p=>p.id===original.id);
  assert.equal(twoGames.games,2); assert.equal(a.state.session.players.length,2);
  returned.ws.close(); await until(()=>!a.state.connectedIds.includes(renewedSeat.playerId));
  await action(a,{type:'remove',playerId:renewedSeat.playerId});
  const fallbackSeat = await post(`/rooms/${a.seat.code}/join`, { name: 'renamed session friend' });
  const fallback = await connect(fallbackSeat); clients.push(fallback);
  assert.equal(fallback.state.session.players.length,2);
  assert.equal(fallback.state.session.players.find(p=>p.memberIds.includes(fallbackSeat.playerId)).id,original.id);
  console.log('PASS: stable browser identity across renamed rejoin, revoked seat credentials, cumulative games/scores, and case-insensitive name fallback');
} finally { for(const c of clients)c.ws.close(); }

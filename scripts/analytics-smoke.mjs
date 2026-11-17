import { writeFileSync } from 'node:fs';
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
  const host = await connect(await post('/rooms', { name: 'Analytics test host' })); clients.push(host);
  const guest = await connect({ ...await post(`/rooms/${host.seat.code}/join`, { name: 'Analytics test guest', guestToken }), guestToken }); clients.push(guest);
  await action(host,{type:'ready'}); await action(guest,{type:'ready'}); await action(host,{type:'start'});
  const watcher=await connect(await post(`/rooms/${host.seat.code}/join`,{name:'Analytics test spectator'}));clients.push(watcher);
  await action(host,{type:'end-game'}); await until(()=>host.state.phase==='finished');
  assert.equal(host.state.results.length,2);
  host.ws.send(JSON.stringify({type:'sync'}));
  const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const playerId=await hash('cambio-analytics-v1:browser:'+await hash(guestToken));
  const report={playerId,points:host.state.results.find(p=>p.id===guest.seat.playerId).score,playerCount:2,gameNumber:host.state.gameNumber};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report));
  console.log(JSON.stringify(report));
} finally {for(const c of clients)c.ws.close();}

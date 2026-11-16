// Real game protocol over the deployed relay; no browser automation.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const site = process.argv[2] || 'https://cambio.shrysjain.me';
const worker = process.env.GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev';
const clients = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, ms = 12000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > ms) throw new Error('Game check timed out'); await pause(15); } }
async function post(base, path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
async function connect(seat, relay) {
  const c = { seat, state: null, errors: [], acks: new Set(), ws: new WebSocket(`${(relay ? site + '/api/game' : worker).replace(/^http/, 'ws')}/rooms/${seat.code}/ws`, { headers: { Origin: site } }) };
  clients.push(c);
  c.ws.on('open', () => c.ws.send(JSON.stringify({ type: 'auth', ...seat })));
  c.ws.on('message', raw => {
    if(raw.toString()==='pong') return;
    const data=JSON.parse(raw.toString()); if(data.type==='state') c.state=data.state; if(data.type==='ack') c.acks.add(data.id); if(data.type==='error') c.errors.push(data.error);
  });
  c.ws.on('error', e => c.errors.push(e.message));
  await until(()=>c.state || c.errors.length); assert.equal(c.errors.length,0,c.errors[0]); return c;
}
async function act(c, action, id=crypto.randomUUID()) {
  const before=c.errors.length; c.ws.send(JSON.stringify({type:'action',id,version:c.state.version,action}));
  await until(()=>c.acks.has(id) || c.errors.length>before); assert.equal(c.errors.length,before,c.errors.at(-1)); await pause(50); return id;
}
try {
  const health=await fetch(site+'/api/game/health'); assert.equal(health.status,200,await health.clone().text()); assert.equal((await health.json()).service,'cambio');
  const seat=await post(site+'/api/game','/rooms',{name:'Relay check host'});
  let host=await connect(seat,true);
  const guest=await connect(await post(worker,`/rooms/${seat.code}/join`,{name:'Direct check friend'}),false);
  await act(host,{type:'ready'}); await act(guest,{type:'ready'}); await act(host,{type:'start'});
  for(const c of [host,guest]) { await act(c,{type:'reveal-initial'}); assert.equal(c.state.players.find(p=>p.id===c.seat.playerId).hand.filter(h=>h?.face).length,2); await act(c,{type:'close-initial'}); }
  await until(()=>host.state.phase==='playing');
  const viewer=await connect(await post(site+'/api/game',`/rooms/${seat.code}/join`,{name:'Relay check watcher'}),true);
  assert.equal(viewer.state.yourRole,'spectator'); assert.ok(viewer.state.players.every(p=>p.hand.every(h=>!h?.face)));
  const turn=[host,guest].find(c=>c.seat.playerId===host.state.activeId);
  const id=await act(turn,{type:'draw'});
  await until(()=>turn.state.drawn); const remaining=turn.state.deckCount;
  await act(turn,{type:'draw'},id); assert.equal(turn.state.deckCount,remaining);
  assert.equal(viewer.state.drawn,null);
  await act(turn,{type:'discard'}); if(turn.state.power) await act(turn,{type:'skip-power'});
  const before=structuredClone(host.state.players);
  host.ws.close(1000,'Check reconnect'); host=await connect(seat,true);
  assert.deepEqual(host.state.players,before); assert.equal(host.state.connectedIds.filter(id=>id===seat.playerId).length,1);
  const invalid=new WebSocket(`${site.replace(/^http/,'ws')}/api/game/rooms/${seat.code}/ws`,{headers:{Origin:site}});
  const denied=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{invalid.terminate();reject(new Error('Auth close timeout'));},8000);invalid.on('close',code=>{clearTimeout(timeout);resolve(code);});invalid.on('error',reject);});
  invalid.on('open',()=>invalid.send(JSON.stringify({type:'auth',playerId:'invalid',token:'invalid'})));
  assert.equal(await denied,4003);
  const currentHost = [host, guest].find(c => c.seat.playerId === host.state.hostId);
  assert.ok(currentHost);
  await act(currentHost,{type:'end-game'}); await until(()=>viewer.state.phase==='finished'); assert.equal(viewer.state.yourRole,'player');
  assert.equal(viewer.state.players.find(p=>p.id===viewer.seat.playerId).score,null);
  console.log('PASS: production relay identity/health, room creation/join, mixed direct/relay players, private peeks/draws, action deduplication, reconnect, auth close codes, scoring, and spectator promotion');
} finally { for(const c of clients)c.ws.close(); }

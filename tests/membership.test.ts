import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, applyAction, finishIfDue, viewFor, type Action } from '../lib/game.ts';
import { joinRoom, promoteQueued, setQueued, syncSpectators, assignConnectedHost } from '../lib/membership.ts';

function table() {
  const g = newGame('AB12', 'a', 'Alex', 1000);
  addPlayer(g, 'b', 'Blake');
  for (const p of g.players) applyAction(g, p.id, { type: 'ready' }, 1000);
  applyAction(g, 'a', { type: 'start' }, 1000);
  g.active = 0;
  joinRoom(g, 's', 'Sam', 1000);
  return g;
}
test('spectator view reveals public positions, never private initial peeks, draws or powers', () => {
  const g = table();
  applyAction(g, 'a', { type: 'reveal-initial' }, 1000);
  let view = viewFor(g, 's');
  assert.equal(view.yourRole, 'spectator');
  assert.equal(view.players[0].hand[2]?.peekedBy, 'a');
  assert.ok(view.players.every(p => p.initialCards === null && p.hand.every(c => !c?.face && !c?.peeking)));
  for (const p of g.players) { if (p.id !== 'a') applyAction(g, p.id, { type: 'reveal-initial' }); applyAction(g, p.id, { type: 'close-initial' }); }
  g.deck.push({ rank: 13, suit: 'diamonds' });
  applyAction(g, 'a', { type: 'draw' });
  view = viewFor(g, 's');
  assert.equal(view.drawn, null); assert.equal(view.hasDrawn, true);
  assert.ok(!('deck' in view));
  applyAction(g, 'a', { type: 'discard' });
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'a', slot: 0 } });
  applyAction(g, 'a', { type: 'peek', target: { playerId: 'b', slot: 0 } });
  view = viewFor(g, 's');
  assert.equal(view.power, null); assert.equal(view.players[1].hand[0]?.peekedBy, 'a');
  assert.ok(view.players.every(p => p.hand.every(c => !c?.face && !c?.peeking)));
  assert.equal(view.discard?.rank, 13);
  for (const type of ['draw', 'ready', 'start', 'end-game', 'reveal-initial'] as const)
    assert.throws(() => applyAction(g, 's', { type }), /seat/);
  const commands: Action[] = [{ type: 'match', target: { playerId: 'a', slot: 0 }, opportunityId: g.opportunity!.id }, { type: 'peek', target: { playerId: 'a', slot: 0 } }, { type: 'recover-player', playerId: 'a' }];
  for (const command of commands) assert.throws(() => applyAction(g, 's', command), /seat/);
  g.flash = { target: { playerId: 'b', slot: 0 }, card: g.players[1].hand[0]!, until: Date.now() + 5000 };
  assert.deepEqual(viewFor(g, 's').players[1].hand[0]?.face, g.flash.card);
});
test('scores precede promotion, old seats remain, all ready checks reset and new seats get no old score', () => {
  const g = table();
  assert.deepEqual(promoteQueued(g, ['a', 'b', 's']), []);
  applyAction(g, 'a', { type: 'end-game' }, 1000);
  finishIfDue(g, 6000);
  const winners = [...g.winners], points = structuredClone(g.session);
  g.players[0].ready = true;
  assert.deepEqual(promoteQueued(g, ['a', 'b', 's']), ['s']);
  assert.deepEqual(g.winners, winners); assert.deepEqual(g.session, points);
  const view = viewFor(JSON.parse(JSON.stringify(g)), 's');
  assert.equal(view.yourRole, 'player'); assert.equal(view.players.find(p => p.id === 's')?.score, null);
  assert.equal(view.spectators.length, 0); assert.ok(g.players.every(p => !p.ready));
  applyAction(g, 'a', { type: 'ready' }); applyAction(g, 'b', { type: 'ready' });
  assert.equal(g.phase, 'finished');
  applyAction(g, 's', { type: 'ready' });
  assert.equal(g.phase, 'peek'); assert.equal(g.players[2].hand.length, 4);
  assert.ok(winners.includes(g.players[g.active].id));
});
test('queue is FIFO, bounded by ten seats, skips offline and opted-out viewers', () => {
  const g = table();
  for (let i = 0; i < 10; i++) joinRoom(g, `s${i}`, `Viewer ${i}`, 1100 + i);
  setQueued(g, 's', false, 1200); setQueued(g, 's0', false, 1200); setQueued(g, 's0', true, 1300);
  g.phase = 'finished';
  const online = ['a', 'b', 's', ...Array.from({ length: 10 }, (_, i) => `s${i}`)].filter(id => id !== 's1');
  assert.deepEqual(promoteQueued(g, online), ['s2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
  assert.equal(g.players.length, 10); assert.equal(g.spectators?.length, 3);
  assert.deepEqual(promoteQueued(g, online), []);
  assert.throws(() => setQueued(g, 'a', true), /Only spectators/);
});
test('spectators reconnect with their queue intact for twenty seconds and cannot inherit host', () => {
  const g = table();
  syncSpectators(g, ['a', 'b', 's'], 1000);
  syncSpectators(g, ['a', 'b'], 2000);
  assert.deepEqual(syncSpectators(g, ['a', 'b'], 21999), []);
  syncSpectators(g, ['a', 'b', 's'], 21999);
  assert.equal(g.spectators?.[0].queuedAt, 1000);
  syncSpectators(g, [], 23000);
  assignConnectedHost(g, ['s']); assert.equal(g.hostId, 'a');
  assignConnectedHost(g, ['b', 's']); assert.equal(g.hostId, 'b');
  assert.deepEqual(syncSpectators(g, [], 43000), ['s']);
  assert.throws(() => viewFor(g, 's'), /seat/);
});
test('names are unique across seats and watchers; spectator membership is capped', () => {
  const g = table();
  assert.throws(() => joinRoom(g, 'x', 'SAM'), /taken/);
  assert.throws(() => joinRoom(g, 'x', 'alex'), /taken/);
  for (let i = 0; i < 19; i++) joinRoom(g, `w${i}`, `Watcher ${i}`);
  assert.throws(() => joinRoom(g, 'extra', 'Extra'), /full/);
});

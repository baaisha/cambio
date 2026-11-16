import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, addPlayer, applyAction, finishIfDue, viewFor } from '../lib/game.ts';
import { joinRoom, switchToSpectating, promoteQueued } from '../lib/membership.ts';
import { bindSessionScore, normalizeSessionScores, sessionScoreId, validGuestToken } from '../lib/session-scores.ts';

function finished() {
  const game = newGame('AB12', 'a', 'Alex'); addPlayer(game, 'b', 'Blake');
  game.phase = 'ending'; game.deadline = 1000;
  game.players[0].hand = [{ rank: 13, suit: 'hearts' }]; game.players[1].hand = [{ rank: 5, suit: 'clubs' }];
  finishIfDue(game, 1000); return game;
}
test('legacy duplicate rows merge signed points and counters exactly once, preserving aliases and game count', () => {
  const game = finished();
  game.session = { games: 4, players: {
    old: { id: 'old', name: 'naaisha', wins: 1, ties: 0, points: 1, games: 2 },
    later: { id: 'later', name: ' NAAISHA ', wins: 0, ties: 1, points: -4, games: 2 },
    other: { id: 'other', name: 'Jam', wins: 0, ties: 1, points: 18, games: 4 },
  } };
  const original = structuredClone(game);
  const displayed = viewFor(game, 'a').session;
  assert.equal(displayed.games, 4); assert.equal(displayed.players.length, 2);
  assert.deepEqual(game, original, 'view migration is read-only');
  normalizeSessionScores(game);
  assert.deepEqual(game.session.players.old, { id: 'old', name: 'naaisha', wins: 1, ties: 1, points: -3, games: 4 });
  assert.equal(sessionScoreId(game, 'later'), 'old');
  const once = JSON.stringify(game); normalizeSessionScores(game); assert.equal(JSON.stringify(game), once);
});
test('new seat reuses browser score identity across names without reviving removed seat credentials', () => {
  const game = finished(); game.hostId = 'b';
  const identity = bindSessionScore(game, 'a', 'Alex');
  applyAction(game, 'b', { type: 'remove', playerId: 'a' });
  joinRoom(game, 'new-seat', 'Alex renamed');
  assert.equal(bindSessionScore(game, 'new-seat', 'Alex renamed', identity), 'a');
  assert.equal(viewFor(game, 'new-seat').session.players.find(p => p.id === 'a')?.memberIds.includes('new-seat'), true);
  assert.throws(() => applyAction(game, 'a', { type: 'ready' }), /seat/);
  for (const p of game.players) applyAction(game, p.id, { type: 'ready' });
  assert.equal(game.phase, 'peek'); assert.equal(game.players[game.active].id, 'new-seat', 'returning winner starts');
  applyAction(game, 'b', { type: 'end-game' }, 2000); finishIfDue(game, 7000);
  assert.equal(game.session?.players.a.games, 2); assert.equal(Object.keys(game.session!.players).length, 2);
});
test('same-name fallback works without browser identity and keeps other names separate', () => {
  const game = finished(); game.hostId = 'b'; applyAction(game, 'b', { type: 'remove', playerId: 'a' });
  joinRoom(game, 'returning', 'alex');
  assert.equal(bindSessionScore(game, 'returning', 'alex'), 'a');
  joinRoom(game, 'different', 'Alexa');
  assert.equal(bindSessionScore(game, 'different', 'Alexa'), 'different');
  assert.throws(() => bindSessionScore(game, 'different', 'Alexa', 'a'), /already have a seat/);
});
test('identity bound before a first score survives reauthentication and spectator transitions', () => {
  const game = newGame('AB12', 'a', 'Alex');
  bindSessionScore(game, 'a', 'Alex');
  game.players = [];
  joinRoom(game, 'new-seat', 'Renamed'); bindSessionScore(game, 'new-seat', 'Renamed', 'a');
  assert.equal(bindSessionScore(game, 'new-seat', 'Renamed'), 'a');
  switchToSpectating(game, 'new-seat');
  game.spectators![0].queuedAt = 1000; promoteQueued(game, ['new-seat']);
  assert.equal(sessionScoreId(game, 'new-seat'), 'a');
});
test('browser identity input is bounded and has no role in seat authentication', () => {
  assert.equal(validGuestToken(crypto.randomUUID() + crypto.randomUUID()), true);
  for (const value of ['', null, 3, 'a'.repeat(129), '../'.repeat(30)]) assert.equal(validGuestToken(value), false);
});

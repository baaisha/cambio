import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { newGame, addPlayer, applyAction, finishIfDue } from '../lib/game.ts';
import { ANALYTICS_PREFIX, completedGame, analyticsStatements, exportAnalytics, type AnalyticsStatement } from '../lib/analytics.ts';

function result() {
  const game = newGame('AB12', 'a', 'Private name'); addPlayer(game, 'b', 'Other name');
  for (const p of game.players) applyAction(game, p.id, { type: 'ready' }, 1000);
  applyAction(game, 'a', { type: 'start' }, 1000);
  game.players[0].hand = [{ rank: 13, suit: 'hearts' }]; game.players[1].hand = [{ rank: 0, suit: 'joker' }];
  applyAction(game, 'a', { type: 'end-game' }, 2000); finishIfDue(game, 7000);
  return game;
}
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_game_analytics.sql', import.meta.url), 'utf8'));
  const write = async (statements: AnalyticsStatement[]) => {
    db.exec('BEGIN');
    try { for (const s of statements) db.prepare(s.sql).run(...s.params); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { db, write };
}
test('completed snapshot excludes names, codes and cards, and remains intact through a rematch', () => {
  const game = result();
  const event = completedGame(game, 'opaque-room', { a: 'browser:hashed-identity' })!;
  assert.equal(event.startedAt, 1000); assert.equal(event.finishedAt, 7000); assert.equal(event.players[0].points, -1);
  assert.deepEqual(event.players.map(p => [p.won, p.tied]), [[1, 0], [0, 0]]);
  addPlayer(game, 'c', 'Promoted spectator');
  assert.equal(completedGame(game, 'opaque-room')!.playerCount, 2);
  const snapshot = JSON.stringify(event);
  for (const secret of ['Private name', 'Other name', 'AB12', 'hearts', 'joker', 'hand']) assert.ok(!snapshot.includes(secret));
  for (const p of game.players) applyAction(game, p.id, { type: 'ready' }, 8000);
  assert.equal(game.startedAt, 8000); assert.equal(game.finishedAt, undefined);
  assert.equal(JSON.stringify(event), snapshot); assert.equal(completedGame(game, 'opaque-room'), null);
});
test('D1 schema and SQL preserve signed scores, prevent duplicate counts and correlate browser identities across rooms', async () => {
  const { db, write } = database();
  try {
    const first = completedGame(result(), 'room-one', { a: 'browser:stable-hash' })!;
    const second = completedGame(result(), 'room-two', { a: 'browser:stable-hash' })!;
    await write(await analyticsStatements(first)); await write(await analyticsStatements(first));
    assert.equal(db.prepare('SELECT count(*) AS n FROM games').get()!.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM game_players').get()!.n, 2);
    assert.equal(db.prepare('SELECT sum(points) AS n FROM game_players').get()!.n, -1);
    await write(await analyticsStatements(second));
    assert.equal(db.prepare("SELECT count(DISTINCT player_id) AS n FROM game_players WHERE identity_kind='browser'").get()!.n, 1);
    assert.equal(db.prepare("SELECT count(DISTINCT player_id) AS n FROM game_players WHERE identity_kind='room'").get()!.n, 2);
    assert.equal(db.prepare('SELECT sum(won) AS n FROM game_players').get()!.n, 2);
    const ids = db.prepare('SELECT player_id FROM game_players').all();
    assert.ok(ids.every(row => /^[a-f0-9]{64}$/.test(String(row.player_id))));
    const invalid = await analyticsStatements({ ...first, gameId: 'invalid', playerCount: 1 });
    await assert.rejects(write(invalid)); assert.equal(db.prepare("SELECT count(*) AS n FROM games WHERE game_id='invalid'").get()!.n, 0);
  } finally { db.close(); }
});
test('failed export or outbox deletion retries without losing records or double-counting', async () => {
  const { db, write } = database();
  const event = completedGame(result(), 'retry-room')!;
  const key = `${ANALYTICS_PREFIX}1`, pending = new Map([[key, event]]);
  try {
    await assert.rejects(exportAnalytics(pending, { write: async () => { throw new Error('D1 unavailable'); }, remove: async key => pending.delete(key) }));
    assert.equal(pending.size, 1);
    await assert.rejects(exportAnalytics(pending, { write, remove: async () => { throw new Error('Interrupted after D1 commit'); } }));
    assert.equal(pending.size, 1);
    await exportAnalytics(pending, { write, remove: async key => pending.delete(key) });
    assert.equal(pending.size, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM games').get()!.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM game_players').get()!.n, 2);
  } finally { db.close(); }
});
test('ties are distinct from outright wins; legacy completed games are not backfilled with invented timestamps', () => {
  const game = result();
  game.players[1].hand = [{ rank: 13, suit: 'diamonds' }];
  game.phase = 'ending'; game.deadline = 9000; finishIfDue(game, 9000);
  assert.deepEqual(completedGame(game, 'tie')!.players.map(p => [p.won, p.tied]), [[0, 1], [0, 1]]);
  delete game.finishedAt; assert.equal(completedGame(game, 'legacy'), null);
});

import { score, type Game } from './game';
import { sessionScoreId } from './session-scores';
export const ANALYTICS_PREFIX = 'analytics:pending:';
export type CompletedGame = {
  gameId: string; roomId: string; gameNumber: number; startedAt: number | null; finishedAt: number;
  playerCount: number; turns: number; queenRule: string;
  players: { key: string; kind: 'browser' | 'room'; points: number; won: number; tied: number }[];
};
export type AnalyticsStatement = { sql: string; params: (string | number | null)[] };

/** Immutable final result, captured before new players are promoted or a rematch starts. */
export function completedGame(game: Game, roomId: string, identities: Record<string, string> = {}): CompletedGame | null {
  if (game.phase !== 'finished' || game.finishedAt === undefined || !game.resultPlayers || game.gameNumber < 1) return null;
  return {
    gameId: `${roomId}:${game.gameNumber}`, roomId, gameNumber: game.gameNumber,
    startedAt: game.startedAt ?? null, finishedAt: game.finishedAt, playerCount: game.resultPlayers.length,
    turns: game.turns, queenRule: game.queenRule ?? 'look-then-swap',
    players: game.resultPlayers.map(player => ({
      key: identities[player.id] ?? `room:${roomId}:${sessionScoreId(game, player.id)}`,
      kind: identities[player.id] ? 'browser' : 'room', points: score(player),
      won: Number(game.winners.length === 1 && game.winners.includes(player.id)),
      tied: Number(game.winners.length > 1 && game.winners.includes(player.id)),
    })),
  };
}
export async function analyticsStatements(event: CompletedGame): Promise<AnalyticsStatement[]> {
  const statements: AnalyticsStatement[] = [{
    sql: 'INSERT INTO games (game_id,room_id,game_number,started_at,finished_at,player_count,turn_count,queen_rule) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO NOTHING',
    params: [event.gameId, event.roomId, event.gameNumber, event.startedAt, event.finishedAt, event.playerCount, event.turns, event.queenRule],
  }];
  for (const [index, player] of event.players.entries()) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cambio-analytics-v1:${player.key}`));
    const id = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    statements.push({
      sql: 'INSERT INTO game_players (game_id,seat_number,player_id,identity_kind,points,won,tied) VALUES (?,?,?,?,?,?,?) ON CONFLICT(game_id,seat_number) DO NOTHING',
      params: [event.gameId, index, id, player.kind, player.points, player.won, player.tied],
    });
  }
  return statements;
}

/** Delete only after an atomic D1 batch succeeds. Replays are harmless if deletion fails. */
export async function exportAnalytics(entries: Map<string, CompletedGame>, io: {
  write: (statements: AnalyticsStatement[]) => Promise<void>;
  remove: (key: string) => Promise<unknown>;
}) {
  for (const [key, event] of entries) {
    await io.write(await analyticsStatements(event));
    await io.remove(key);
  }
}

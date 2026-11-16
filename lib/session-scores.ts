import type { Game, SessionScore } from './game';

export const scoreNameKey = (name: string) => name.trim().toLowerCase();
export function sessionScoreId(game: Game, memberId: string): string {
  let id = memberId;
  const seen = new Set<string>();
  while (game.scoreIds?.[id] && game.scoreIds[id] !== id && !seen.has(id)) {
    seen.add(id); id = game.scoreIds[id];
  }
  return id;
}

/** Idempotent migration: fold old seat rows together without changing the room's game count. */
export function normalizeSessionScores(game: Game) {
  if (!game.session) return;
  const players: Record<string, SessionScore> = {};
  const names = new Map<string, string>();
  for (const row of Object.values(game.session.players)) {
    const key = scoreNameKey(row.name);
    const canonical = names.get(key) ?? sessionScoreId(game, row.id);
    names.set(key, canonical);
    const existing = players[canonical];
    if (existing) {
      existing.wins += row.wins; existing.ties += row.ties;
      existing.points += row.points; existing.games += row.games;
    } else players[canonical] = { ...row, id: canonical, name: row.name.trim() };
    if (row.id !== canonical) { game.scoreIds ??= {}; game.scoreIds[row.id] = canonical; }
  }
  game.session.players = players;
}

export function bindSessionScore(game: Game, memberId: string, name: string, previousIdentity?: string) {
  normalizeSessionScores(game);
  const existing = Object.values(game.session?.players ?? {}).find(p => scoreNameKey(p.name) === scoreNameKey(name));
  const preferred = previousIdentity ?? game.scoreIds?.[memberId];
  const canonical = preferred ? sessionScoreId(game, preferred) : existing?.id ?? memberId;
  const active = [...game.players, ...(game.spectators ?? [])];
  if (active.some(p => p.id !== memberId && sessionScoreId(game, p.id) === canonical)) throw new Error('You already have a seat in this room. Reopen the room invite to reconnect.');
  game.scoreIds ??= {}; game.scoreIds[memberId] = canonical;
  const row = game.session?.players[canonical];
  if (row) row.name = name;
  normalizeSessionScores(game);
  return sessionScoreId(game, memberId);
}

export function sessionScoreView(game: Game) {
  // Legacy rooms also display merged rows on read, without mutating the authoritative game.
  const copy: Game = { ...game, scoreIds: { ...game.scoreIds }, session: game.session ? { games: game.session.games, players: { ...game.session.players } } : undefined };
  normalizeSessionScores(copy);
  return { games: copy.session?.games ?? 0, players: Object.values(copy.session?.players ?? {}).map(p => ({ ...p, memberIds: [...game.players, ...(game.spectators ?? [])].filter(member => sessionScoreId(copy, member.id) === p.id).map(member => member.id) })) };
}

export const validGuestToken = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(value);

CREATE TABLE games (
  game_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  game_number INTEGER NOT NULL CHECK (game_number > 0),
  started_at INTEGER,
  finished_at INTEGER NOT NULL,
  player_count INTEGER NOT NULL CHECK (player_count BETWEEN 2 AND 10),
  turn_count INTEGER NOT NULL CHECK (turn_count >= 0),
  queen_rule TEXT NOT NULL CHECK (queen_rule IN ('look-then-swap', 'swap-then-look')),
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX games_finished_at_idx ON games(finished_at);
CREATE TABLE game_players (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 0 AND 9),
  player_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('browser', 'room')),
  points INTEGER NOT NULL,
  won INTEGER NOT NULL CHECK (won IN (0, 1)),
  tied INTEGER NOT NULL CHECK (tied IN (0, 1)),
  PRIMARY KEY (game_id, seat_number),
  CHECK (won + tied <= 1)
);
CREATE INDEX game_players_player_id_idx ON game_players(player_id);

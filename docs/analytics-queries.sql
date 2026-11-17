-- Lifetime completed games and rooms.
SELECT count(*) AS games_played, count(DISTINCT room_id) AS rooms FROM games;
-- Anonymous identities, not verified people. Legacy room-scoped identities are reported separately.
SELECT identity_kind, count(DISTINCT player_id) AS unique_players FROM game_players GROUP BY identity_kind;
-- Daily activity (UTC), including unique identities that completed a game that day.
SELECT date(g.finished_at / 1000, 'unixepoch') AS day,
       count(DISTINCT g.game_id) AS games_played,
       count(DISTINCT p.player_id) AS unique_players
FROM games g JOIN game_players p USING(game_id) GROUP BY day ORDER BY day DESC;
-- Per-identity totals. A tied win is counted in ties, not outright wins.
SELECT player_id, identity_kind, count(*) AS games_played,
       sum(won) AS wins, sum(tied) AS ties, sum(points) AS total_points,
       round(avg(points), 2) AS average_points
FROM game_players GROUP BY player_id, identity_kind ORDER BY games_played DESC;
-- Durations exclude older games that were already running when recording was enabled.
SELECT round(avg(player_count), 2) AS average_players,
       round(avg((finished_at - started_at) / 1000.0), 1) AS average_duration_seconds
FROM games;

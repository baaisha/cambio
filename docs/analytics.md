# Anonymous game analytics

Database: `cambio-analytics`. Worker binding: `ANALYTICS`. Schema: `migrations/0001_game_analytics.sql`.

Recording begins with games completed after this deployment. We do not invent historical game records from session totals. A game already running when recording is enabled may have a null `started_at`; its actual finishing time and scores are still recorded. Host-ended games count because they produce final scores; abandoned games do not.

## Stored data

- `games`: opaque game/room IDs, game number, start/end timestamps in Unix milliseconds, player count, turn count, Queen rule, and database insertion time.
- `game_players`: one result per participating seat, pseudonymous player ID, identity kind, signed points, outright-win flag, and tied-win flag.
- No names, room codes, IP addresses, authentication/guest tokens, cards, or peeks are stored in D1. Spectators and newly promoted next-game players are excluded from the game they watched.

For refreshed clients, player IDs are domain-separated hashes of the existing random browser identity hash, stable across rooms. They estimate browsers, not people: shared browsers, private browsing, cleared storage, or multiple devices affect uniqueness. Older clients without an identity get a room-scoped score-identity hash (`identity_kind = 'room'`), which cannot deduplicate them across rooms. Name-based session-score merging never links names across rooms in analytics.

## Reliability and latency

The final, immutable analytics event and authoritative room state are written atomically to Durable Object storage before acknowledgment. An outbox key is retained independently of subsequent games. `waitUntil()` exports it in the background; no D1 request is awaited in the game action path. One transactional D1 batch inserts the game and its player results with primary-key conflict protection. Export retries cannot double-count a committed game, including a crash after D1 commit but before outbox deletion.

Pending exports retry by alarm with backoff, from one minute up to one hour. Room access still expires normally; cleanup retains its durable outbox until export succeeds. A D1 outage or quota error does not block gameplay. Export failures emit a generic Worker log message without IDs or private data. No public stats or administration API is exposed.

## Query or export later

Run from the repository with your existing Cloudflare login:

```sh
npx wrangler d1 execute cambio-analytics --remote --command "SELECT count(*) AS games_played FROM games;"
npx wrangler d1 export cambio-analytics --remote --output /tmp/cambio-analytics.sql
```

Copy individual queries from `docs/analytics-queries.sql` into `--command` to return their rows. (`--file` uses the SQL import path and returns an execution summary.) Use `--local` for local development. Apply schema changes with:

```sh
npx wrangler d1 migrations apply cambio-analytics --local
npx wrangler d1 migrations apply cambio-analytics --remote
```

The existing Workers Free allowance includes 100,000 D1 rows written/day, 5 million read/day, and 5 GB total storage. Each completed game creates one game row and 2–10 result rows; indexes also count toward writes. There are no writes per click or live dashboard queries. No paid-plan upgrade is required. Current limits: https://developers.cloudflare.com/d1/platform/pricing/.

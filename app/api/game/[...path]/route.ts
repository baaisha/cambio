import { upgradeWebSocket, ipAddress } from '@vercel/functions';
import { getVercelOidcToken } from '@vercel/oidc';
import { attachGameRelay } from '@/lib/game-socket-relay';
import { gameRelayPath } from '@/lib/relay-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const upstream = (process.env.NEXT_PUBLIC_GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev').replace(/\/$/, '');
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = gameRelayPath((await context.params).path, request.method);
  if (!path) return json('Not found.', 404);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json('Origin not allowed.', 403);
  if (path.endsWith('/ws')) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json('WebSocket connection required.', 426);
    try {
      return await upgradeWebSocket(client => {
        attachGameRelay(client, `${upstream.replace(/^http/, 'ws')}${path}`, origin ?? undefined);
      }, { maxPayload: 4096 });
    } catch { return json('The game relay could not accept this connection. Please reconnect.', 503); }
  }
  try {
    const headers = new Headers();
    if (origin) headers.set('Origin', origin);
    if (request.method === 'POST' || path === '/health') {
      headers.set('x-cambio-relay-token', await getVercelOidcToken());
      headers.set('x-cambio-client-ip', ipAddress(request) ?? '0.0.0.0');
    }
    let body: string | undefined;
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length') ?? 0) > 2048) return json('Request too large.', 413);
      body = await request.text();
      if (body.length > 2048) return json('Request too large.', 413);
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${upstream}${path}`, { method: request.method, body, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return json('The relay could not complete the request. Please reconnect before trying again.', 502); }
}
export const GET = handle;
export const POST = handle;

import { upgradeWebSocket } from '@vercel/functions';
import { attachDiagnosticRelay } from '@/lib/diagnostic-relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const upstream = process.env.NEXT_PUBLIC_GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev';

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Origin not allowed' }, { status: 403 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Response.json({ error: 'WebSocket connection required' }, { status: 426 });
  try {
    return await upgradeWebSocket(client => {
      attachDiagnosticRelay(client, `${upstream.replace(/^http/, 'ws').replace(/\/$/, '')}/diagnostics/echo`, origin ?? undefined);
    }, { maxPayload: 256 });
  } catch {
    return Response.json({ error: 'WebSocket upgrade unavailable in this runtime. Use the deployed Vercel page.' }, { status: 503 });
  }
}

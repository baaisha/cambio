export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
const upstream = process.env.NEXT_PUBLIC_GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev';

export async function GET() {
  const started = Date.now();
  try {
    const response = await fetch(`${upstream.replace(/\/$/, '')}/health`, { cache: 'no-store', signal: AbortSignal.timeout(8000), redirect: 'error' });
    const body = await response.json();
    if (!response.ok || body.ok !== true || body.service !== 'cambio') throw new Error('Unexpected Worker response');
    return Response.json({ ok: true, via: 'vercel', upstream: 'cloudflare-worker', upstreamMs: Date.now() - started, checkedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, stage: 'upstream', error: 'Vercel could not reach the Worker health endpoint.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

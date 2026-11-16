import WebSocket from 'ws';
import { diagnosticNonce, DIAGNOSTIC_CYCLE_MS } from './connection-check';

/** Fixed upstream only. A transport probe, never a general-purpose proxy. */
export function attachDiagnosticRelay(client: WebSocket, upstreamUrl: string, origin?: string) {
  const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 8000, maxPayload: 512, headers: origin ? { Origin: origin } : undefined });
  let count = 0;
  const send = (data: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data)); };
  const cycle = setTimeout(() => client.close(1000, 'Diagnostic reconnect'), DIAGNOSTIC_CYCLE_MS);
  const cleanup = () => { clearTimeout(cycle); upstream.terminate(); };
  upstream.on('open', () => send({ type: 'ready', via: 'vercel' }));
  upstream.on('message', (data, binary) => {
    if (binary) { client.close(1011, 'Unexpected upstream response'); return; }
    try {
      const value = JSON.parse(data.toString());
      if (value?.type === 'ready') return;
      if (value?.type !== 'echo' || typeof value.id !== 'string' || typeof value.workerTime !== 'number') throw new Error('Invalid echo');
      send({ type: 'echo', id: value.id, workerTime: value.workerTime });
    } catch { client.close(1011, 'Unexpected upstream response'); }
  });
  upstream.on('error', () => {
    send({ type: 'error', stage: 'upstream', error: 'Vercel could not connect to the Worker echo endpoint.' });
    client.close(1011, 'Worker connection failed');
  });
  upstream.on('close', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'Worker connection closed');
  });
  client.on('message', (data, binary) => {
    const message = data.toString();
    if (binary || ++count > 30 || diagnosticNonce(message) === null) { client.close(1008, 'Invalid diagnostic message'); return; }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
    else client.close(1013, 'Worker is not connected');
  });
  client.on('close', cleanup);
  client.on('error', cleanup);
}

import WebSocket from 'ws';

/** Transparent, bounded bridge. The Worker remains responsible for authentication and rules. */
export function attachGameRelay(client: WebSocket, upstreamUrl: string, origin?: string, rotateMs = 240000) {
  const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 8000, maxPayload: 256 * 1024, headers: origin ? { Origin: origin } : undefined });
  const buffered: string[] = [];
  const rotate = setTimeout(() => { client.close(1012, 'Relay reconnect'); upstream.terminate(); }, rotateMs);
  const cleanup = () => { clearTimeout(rotate); upstream.terminate(); buffered.length = 0; };
  upstream.on('open', () => { for (const message of buffered.splice(0)) upstream.send(message); });
  upstream.on('message', (data, binary) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (binary) { client.close(1003, 'Text messages required'); return; }
    client.send(data.toString());
  });
  upstream.on('close', (code, reason) => {
    if (client.readyState !== WebSocket.OPEN) return;
    client.close(code === 1005 || code === 1006 || code === 1015 ? 1011 : code, reason.toString().slice(0, 100));
  });
  upstream.on('unexpected-response', (_request, response) => {
    response.resume();
    client.close(response.statusCode === 404 ? 4004 : 1011, response.statusCode === 404 ? 'Room expired.' : 'Game server connection failed.');
    upstream.terminate();
  });
  upstream.on('error', () => { if (client.readyState === WebSocket.OPEN) client.close(1011, 'Game server connection failed.'); });
  client.on('message', (data, binary) => {
    if (binary || data.toString().length > 4096) { client.close(1009, 'Message too large.'); return; }
    const message = data.toString();
    if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
    else if (upstream.readyState === WebSocket.CONNECTING && buffered.length < 4) buffered.push(message);
    else client.close(1013, 'Game server is not connected.');
  });
  client.on('close', cleanup);
  client.on('error', cleanup);
}

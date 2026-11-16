export type GameRoute = 'direct' | 'relay';

/** One selected transport per tab. Writes are never automatically retried. */
export class GameTransport {
  route: GameRoute = 'direct';
  private checked = false;
  private selecting: Promise<void> | null = null;
  onChange?: (route: GameRoute) => void;
  constructor(private direct: string, private fetcher: typeof fetch = fetch, private probeMs = 2200) {}
  useRelay() {
    if (this.route === 'relay') return;
    this.route = 'relay'; this.checked = false; this.onChange?.('relay');
  }
  private base() { return this.route === 'relay' ? '/api/game' : this.direct.replace(/\/$/, ''); }
  async ensure() {
    if (this.checked) return;
    if (this.selecting) return this.selecting;
    this.selecting = (async () => {
      const probe = async () => {
        const response = await this.fetcher(`${this.base()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(this.route === 'direct' ? this.probeMs : 10000) });
        const body = await response.json();
        if (!response.ok || body.ok !== true || body.service !== 'cambio') throw new Error('Game server unavailable');
      };
      try { await probe(); }
      catch { if (this.route === 'relay') throw new Error('Game server unavailable'); this.useRelay(); await probe(); }
      this.checked = true;
    })();
    try { await this.selecting; } finally { this.selecting = null; }
  }
  async request(path: string, init: RequestInit = {}) {
    await this.ensure();
    const send = () => this.fetcher(`${this.base()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(!init.method || init.method === 'GET' ? 3500 : 10000)]) });
    try { return await send(); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      if (this.route === 'direct') {
        this.useRelay();
        if (!init.method || init.method === 'GET') return send();
      }
      // A failed POST may have already created a room/seat. Never send it twice.
      throw new Error('Connection interrupted. The request may have reached the server. Reopen your invite to reconnect, or try again.');
    }
  }
  socketUrl(code: string, origin: string) {
    const base = this.route === 'relay' ? `${origin}/api/game` : this.direct.replace(/\/$/, '');
    return `${base.replace(/^http/, 'ws')}/rooms/${code}/ws`;
  }
}

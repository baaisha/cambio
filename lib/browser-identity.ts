import { validGuestToken } from './session-scores';
let fallback: string | undefined;
/** Room-independent browser identity. Never used to authenticate or reclaim a game seat. */
export function browserGuestToken() {
  if (fallback) return fallback;
  try {
    const saved = localStorage.getItem('cambio:guest-identity');
    if (validGuestToken(saved)) { fallback = saved; return saved; }
  } catch { /* In-memory identity still works if browser storage is unavailable. */ }
  fallback = crypto.randomUUID() + crypto.randomUUID();
  try { localStorage.setItem('cambio:guest-identity', fallback); } catch {}
  return fallback;
}

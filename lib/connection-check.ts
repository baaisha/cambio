/** Diagnostics accept only a short nonce; no room credentials or game actions. */
export function diagnosticNonce(message: string): string | null {
  if (message.length > 256) return null;
  try {
    const value = JSON.parse(message);
    return value?.type === 'ping' && typeof value.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.id) ? value.id : null;
  } catch { return null; }
}
export const DIAGNOSTIC_CYCLE_MS = 45000;

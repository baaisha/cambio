import { validRoomCode } from './room-code';

export function gameRelayPath(parts: string[], method: string): string | null {
  if (parts.length === 1 && parts[0] === 'health' && method === 'GET') return '/health';
  if (parts.length === 1 && parts[0] === 'rooms' && (method === 'GET' || method === 'POST')) return '/rooms';
  if (parts.length === 3 && parts[0] === 'rooms' && validRoomCode(parts[1]) && ((parts[2] === 'join' && method === 'POST') || (parts[2] === 'ws' && method === 'GET'))) return `/rooms/${parts[1]}/${parts[2]}`;
  return null;
}

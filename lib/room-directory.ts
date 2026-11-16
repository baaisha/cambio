import type { Game } from './game';
export type DirectoryListing = { id: string; hostName: string; players: number; gameNumber: number; phase: Game['phase']; updatedAt: number; private: true; connected: boolean };
export type DirectoryPublication = { key: string; updatedAt: number; sentAt: number };
const REFRESH_MS = 5 * 60 * 1000;

/** Serialized, coalesced publication. Never reads or writes the authoritative room record. */
export class RoomDirectoryPublisher {
  private pending: DirectoryListing | null = null;
  private running: Promise<void> | null = null;
  constructor(private io: {
    read: () => Promise<DirectoryPublication | undefined>;
    save: (value: DirectoryPublication) => Promise<void>;
    send: (listing: DirectoryListing) => Promise<void>;
    now?: () => number;
  }) {}
  enqueue(listing: DirectoryListing) {
    this.pending = listing;
    if (!this.running) {
      this.running = Promise.resolve().then(async () => {
        try {
          while (this.pending) {
            const entry = this.pending; this.pending = null;
            try {
              const previous = await this.io.read();
              const key = JSON.stringify([entry.id, entry.hostName, entry.players, entry.gameNumber, entry.phase, entry.connected]);
              const now = this.io.now?.() ?? Date.now();
              if (previous?.key === key && (entry.updatedAt <= previous.updatedAt || now - previous.sentAt < REFRESH_MS)) continue;
              await this.io.send(entry);
              await this.io.save({ key, updatedAt: entry.updatedAt, sentAt: now });
            } catch {
              // Keep the last successful marker. A later room event retries publication.
              // Consume only the latest queued snapshot, rather than building a retry backlog.
            }
          }
        } finally { this.running = null; }
      });
    }
    return this.running;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomDirectoryPublisher, type DirectoryListing, type DirectoryPublication } from '../lib/room-directory.ts';
const entry = (patch: Partial<DirectoryListing> = {}): DirectoryListing => ({ id: 'opaque-room-id', hostName: 'Alex', players: 2, gameNumber: 1, phase: 'playing', updatedAt: 1000, private: true, connected: true, ...patch });

test('unchanged actions skip directory writes across hibernation; activity refresh is throttled', async () => {
  let marker: DirectoryPublication | undefined, now = 1000;
  const sent: DirectoryListing[] = [];
  const io = { read: async () => marker, save: async (value: DirectoryPublication) => { marker = value; }, send: async (listing: DirectoryListing) => { sent.push(listing); }, now: () => now };
  await new RoomDirectoryPublisher(io).enqueue(entry());
  const restored = new RoomDirectoryPublisher(io);
  now = 2000; await restored.enqueue(entry({ updatedAt: 2000 }));
  assert.equal(sent.length, 1);
  now = 301001; await restored.enqueue(entry({ updatedAt: 301001 }));
  assert.equal(sent.length, 2);
  now = 999999; await restored.enqueue(entry({ updatedAt: 301001 }));
  assert.equal(sent.length, 2, 'idle room activity is not artificially extended');
});
test('host, seats, phase, next game and presence changes publish immediately', async () => {
  let marker: DirectoryPublication | undefined;
  const sent: DirectoryListing[] = [];
  const publisher = new RoomDirectoryPublisher({ read: async () => marker, save: async value => { marker = value; }, send: async listing => { sent.push(listing); } });
  const snapshots = [entry(), entry({ hostName: 'Blake' }), entry({ hostName: 'Blake', players: 3 }), entry({ phase: 'finished' }), entry({ gameNumber: 2, phase: 'peek' }), entry({ connected: false })];
  for (const snapshot of snapshots) await publisher.enqueue(snapshot);
  assert.deepEqual(sent, snapshots);
});
test('slow publication coalesces updates and sends the last disconnect after older online entries', async () => {
  let release!: () => void, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const sent: DirectoryListing[] = [];
  let marker: DirectoryPublication | undefined;
  const publisher = new RoomDirectoryPublisher({ read: async () => marker, save: async value => { marker = value; }, send: async listing => { sent.push(listing); if (sent.length === 1) { began(); await blocked; } } });
  const work = publisher.enqueue(entry()); await started;
  publisher.enqueue(entry({ players: 3 }));
  publisher.enqueue(entry({ phase: 'finished' }));
  publisher.enqueue(entry({ connected: false }));
  assert.equal(sent.length, 1, 'no concurrent or out-of-order directory requests');
  release(); await work;
  assert.equal(sent.length, 2); assert.equal(sent.at(-1)?.connected, false);
});
test('failed publication does not mark success and retries on a later room event', async () => {
  let marker: DirectoryPublication | undefined, failed = true, calls = 0;
  const publisher = new RoomDirectoryPublisher({ read: async () => marker, save: async value => { marker = value; }, send: async () => { calls++; if (failed) throw new Error('Offline'); } });
  await publisher.enqueue(entry()); assert.equal(marker, undefined);
  failed = false; await publisher.enqueue(entry()); assert.ok(marker); assert.equal(calls, 2);
});

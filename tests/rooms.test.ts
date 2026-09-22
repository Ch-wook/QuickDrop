import { describe, expect, it } from 'vitest';
import { Rooms, RateLimiter } from '../server/rooms';

describe('temporary rooms', () => {
  it('creates unpredictable IDs and distinct short codes', () => {
    const rooms = new Rooms(1000);
    const a = rooms.create(); const b = rooms.create();
    expect(a.roomId).toMatch(/^[\w-]{32}$/);
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.roomId).not.toBe(b.roomId); expect(a.code).not.toBe(b.code);
  });
  it('rejects missing and expired rooms and reserves the owner slot', () => {
    let now = 0; const rooms = new Rooms(1000, () => now);
    const room = rooms.create();
    expect(() => rooms.join('a', { roomId: 'missing' })).toThrow();
    expect(() => rooms.join('a', { code: room.code })).toThrow();
    now = 1001;
    expect(() => rooms.join('a', room)).toThrow(/만료/);
    rooms.sweep(); expect(rooms.rooms.size).toBe(0);
  });
  it('allows exactly two equal peers, by ID or code', () => {
    const rooms = new Rooms(1000); const room = rooms.create();
    rooms.join('a', room); rooms.join('b', { code: room.code });
    expect(() => rooms.join('c', { roomId: room.roomId })).toThrow(/두 기기/);
    rooms.leave(room.roomId, 'a');
    rooms.join('c', { roomId: room.roomId });
    expect([...rooms.rooms.get(room.roomId)!.peers]).toEqual(['b', 'c']);
  });
  it('expires waiting rooms but keeps two connected peers until departure', () => {
    let now = 0; const rooms = new Rooms(1000, () => now); const room = rooms.create();
    rooms.join('a', room); rooms.join('b', { code: room.code });
    now = 1500; expect(rooms.sweep()).toEqual([]);
    rooms.leave(room.roomId, 'b');
    now = 2501; expect(rooms.sweep()).toEqual(['a']); expect(rooms.rooms.size).toBe(0);
  });
  it('removes a room and its code when all peers leave', () => {
    const rooms = new Rooms(1000); const room = rooms.create(); rooms.join('a', room); rooms.leave(room.roomId, 'a');
    expect(rooms.rooms.size).toBe(0); expect(() => rooms.join('b', { code: room.code })).toThrow();
  });
});
it('limits guessing per IP and resets after the time window', () => {
  let now = 0; const limiter = new RateLimiter(2, 1000, () => now);
  expect(limiter.allow('a')).toBe(true); expect(limiter.allow('a')).toBe(true); expect(limiter.allow('a')).toBe(false);
  expect(limiter.allow('b')).toBe(true); now = 1000; expect(limiter.allow('a')).toBe(true);
});

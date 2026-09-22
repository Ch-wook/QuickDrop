import { randomBytes, randomInt } from 'node:crypto';
import type { CreatedRoom, RoomInfo } from '../shared/protocol';

type Room = RoomInfo & { ownerToken: string; peers: Set<string> };
export class Rooms {
  readonly rooms = new Map<string, Room>();
  private codes = new Map<string, string>();
  constructor(private ttl: number, private now = Date.now) {}
  create(): CreatedRoom {
    if (this.rooms.size >= 10000) throw new Error('서버가 혼잡합니다. 잠시 후 다시 시도하세요.');
    const roomId = randomBytes(24).toString('base64url');
    const ownerToken = randomBytes(24).toString('base64url');
    let code: string;
    do { code = randomInt(100000, 1000000).toString(); } while (this.codes.has(code));
    const room = { roomId, ownerToken, code, expiresAt: this.now() + this.ttl, peers: new Set<string>() };
    this.rooms.set(roomId, room);
    this.codes.set(code, roomId);
    return { roomId, ownerToken, code, expiresAt: room.expiresAt };
  }
  join(peerId: string, target: { roomId?: string; code?: string; ownerToken?: string }): Room {
    const room = this.rooms.get(target.roomId ?? this.codes.get(target.code ?? '') ?? '');
    if (!room || (room.peers.size < 2 && room.expiresAt <= this.now())) throw new Error('연결 코드를 확인하세요. 세션이 없거나 만료되었습니다.');
    if (room.peers.size >= 2) throw new Error('이미 두 기기가 연결되어 있습니다.');
    if (!room.peers.size && target.ownerToken !== room.ownerToken) throw new Error('다른 기기가 아직 연결을 준비하고 있습니다. 잠시 후 다시 시도하세요.');
    room.peers.add(peerId);
    return room;
  }
  leave(roomId: string, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !room.peers.delete(peerId)) return;
    if (!room.peers.size) this.remove(roomId);
    else room.expiresAt = this.now() + this.ttl;
  }
  remove(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room) this.codes.delete(room.code);
    this.rooms.delete(roomId);
  }
  sweep(): string[] {
    const expiredPeers: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.peers.size < 2 && room.expiresAt <= this.now()) {
        expiredPeers.push(...room.peers);
        this.remove(room.roomId);
      }
    }
    return expiredPeers;
  }
}

export class RateLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private limit: number, private interval: number, private now = Date.now) {}
  allow(key: string): boolean {
    this.sweep();
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 20000) return false;
      entry = { count: 0, until: this.now() + this.interval };
      this.entries.set(key, entry);
    }
    return ++entry.count <= this.limit;
  }
  sweep() { for (const [key, value] of this.entries) if (value.until <= this.now()) this.entries.delete(key); }
}

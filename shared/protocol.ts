import { z } from 'zod';

export const ROOM_ID = /^[A-Za-z0-9_-]{32}$/;
export const TRANSFER_ID = /^[0-9a-f-]{36}$/i;
export const CHUNK_SIZE = 16 * 1024; // Conservative across Safari, Firefox and Chromium.
export const MAX_TEXT_LENGTH = 8000;
export const MAX_HISTORY = 300;

const id = z.string().regex(TRANSFER_ID);
const candidate = z.object({
  candidate: z.string().max(4096),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();

export const signalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('JOIN'), roomId: z.string().regex(ROOM_ID).optional(), code: z.string().regex(/^\d{6}$/).optional(), ownerToken: z.string().max(64).optional(), deviceId: z.string().uuid().optional(), resumeToken: z.string().uuid().optional() }).strict()
    .refine(v => Boolean(v.roomId) !== Boolean(v.code), 'Specify roomId OR code'),
  z.object({ type: z.literal('LEAVE') }).strict(),
  z.object({ type: z.literal('RECONNECT') }).strict(),
  z.object({ type: z.literal('OFFER'), sdp: z.string().min(1).max(32000), negotiationId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('ANSWER'), sdp: z.string().min(1).max(32000), negotiationId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('ICE_CANDIDATE'), candidate, negotiationId: z.string().uuid().optional() }).strict(),
]);
export type ClientSignal = z.infer<typeof signalSchema>;
export type RoomInfo = { roomId: string; code: string; expiresAt: number };
export type CreatedRoom = RoomInfo & { ownerToken: string };
export type ServerSignal =
  | ({ type: 'JOINED'; peerId: string; resumeToken?: string; resumed?: boolean } & RoomInfo)
  | { type: 'PEER_JOINED' | 'PEER_RESUMED'; initiator: boolean; peerDeviceId?: string; negotiationId?: string }
  | { type: 'PEER_LEFT' }
  | { type: 'ROOM_EXPIRED' }
  | { type: 'ERROR'; message: string }
  | Exclude<ClientSignal, { type: 'JOIN' | 'LEAVE' | 'RECONNECT' }>;

export function asLink(value: string): string | null {
  try {
    const trimmed = value.trim();
    if (/\s/.test(trimmed)) return null;
    const url = new URL(trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname ? url.href : null;
  } catch { return null; }
}

export function safeFilename(name: string): string {
  const clean = name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
  if (!clean) return 'download';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}

export const transferSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), id, text: z.string().min(1).max(MAX_TEXT_LENGTH) }).strict(),
  z.object({ type: z.literal('LINK'), id, text: z.string().max(MAX_TEXT_LENGTH).refine(v => asLink(v) !== null) }).strict(),
  z.object({ type: z.literal('FILE_START'), id, name: z.string().min(1).max(255), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), mime: z.string().max(128) }).strict(),
  z.object({ type: z.literal('FILE_END'), id }).strict(),
  z.object({ type: z.literal('TRANSFER_COMPLETE'), id }).strict(),
  z.object({ type: z.literal('TRANSFER_CANCEL'), id }).strict(),
  z.object({ type: z.literal('TRANSFER_ERROR'), id, message: z.string().max(240) }).strict(),
]);
export type TransferMessage = z.infer<typeof transferSchema>;
export type FileMetadata = Extract<TransferMessage, { type: 'FILE_START' }>;
export type TransferStatus = 'sending' | 'receiving' | 'confirming' | 'complete' | 'cancelled' | 'error';
export const isActive = (status: TransferStatus) => ['sending', 'receiving', 'confirming'].includes(status);
export type Transfer = {
  id: string; direction: 'sent' | 'received'; kind: 'text' | 'link' | 'file';
  time: number; status: TransferStatus; text?: string; name?: string; size?: number;
  mime?: string; bytes: number; url?: string; blob?: Blob; error?: string;
};
export type PublicConfig = { publicUrl: string; maxFileSize: number; maxSessionBytes: number; iceServers: RTCIceServer[] };

// FILE_CHUNK: 36 ASCII UUID bytes + uint32 big-endian sequence + payload.
const chunkEncoder = new TextEncoder();
const chunkDecoder = new TextDecoder();
export function encodeChunk(id: string, sequence: number, bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (!TRANSFER_ID.test(id) || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff || bytes.byteLength === 0 || bytes.byteLength > CHUNK_SIZE) throw new Error('Invalid chunk');
  const packet = new ArrayBuffer(40 + bytes.byteLength);
  new Uint8Array(packet).set(chunkEncoder.encode(id));
  new DataView(packet).setUint32(36, sequence);
  new Uint8Array(packet, 40).set(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  return packet;
}
export function decodeChunk(packet: ArrayBuffer) {
  if (packet.byteLength <= 40 || packet.byteLength > CHUNK_SIZE + 40) throw new Error('Invalid chunk size');
  const id = chunkDecoder.decode(new Uint8Array(packet, 0, 36));
  if (!TRANSFER_ID.test(id)) throw new Error('Invalid transfer ID');
  return { id, sequence: new DataView(packet).getUint32(36), bytes: packet.slice(40) };
}

export class FileAssembler {
  private parts: ArrayBuffer[] = [];
  private sequence = 0;
  bytes = 0;
  constructor(readonly metadata: FileMetadata, limit: number) {
    if (metadata.size > limit) throw new Error('파일 크기 제한을 초과했습니다.');
  }
  append(sequence: number, bytes: ArrayBuffer) {
    if (sequence !== this.sequence || bytes.byteLength === 0 || bytes.byteLength > CHUNK_SIZE || this.bytes + bytes.byteLength > this.metadata.size) throw new Error('파일 조각의 순서 또는 크기가 올바르지 않습니다.');
    this.parts.push(bytes);
    this.sequence++;
    this.bytes += bytes.byteLength;
  }
  finish(): Blob {
    if (this.bytes !== this.metadata.size) throw new Error('파일이 완전히 수신되지 않았습니다.');
    const blob = new Blob(this.parts, { type: this.metadata.mime || 'application/octet-stream' });
    this.parts = [];
    return blob;
  }
}

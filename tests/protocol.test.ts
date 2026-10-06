import { describe, expect, it } from 'vitest';
import { asLink, CHUNK_SIZE, decodeChunk, encodeChunk, FileAssembler, safeFilename, signalSchema, transferSchema } from '../shared/protocol';

const id = '81b469ac-4ac0-4dd9-8a1f-54d2e332a11a';
describe('protocol validation', () => {
  it('accepts signaling and rejects arbitrary payloads, oversized SDP and ambiguous joins', () => {
    expect(signalSchema.safeParse({ type: 'JOIN', code: '123456' }).success).toBe(true);
    expect(signalSchema.safeParse({ type: 'ICE_CANDIDATE', candidate: { candidate: 'candidate:1', sdpMid: '0' } }).success).toBe(true);
    for (const message of [{ type: 'TEXT', text: 'secret' }, { type: 'JOIN' }, { type: 'JOIN', code: '123456', roomId: 'a'.repeat(32) }, { type: 'JOIN', code: '12345' }, { type: 'OFFER', sdp: 'a'.repeat(32001) }, { type: 'ANSWER', sdp: 'valid', extra: true }]) expect(signalSchema.safeParse(message).success).toBe(false);
  });
  it('validates file metadata and rejects negative/fractional sizes and executable links', () => {
    expect(transferSchema.safeParse({ type: 'FILE_START', id, name: 'photo.png', size: 10, mime: 'image/png' }).success).toBe(true);
    for (const size of [-1, 2.2, Infinity]) expect(transferSchema.safeParse({ type: 'FILE_START', id, name: 'a', size, mime: '' }).success).toBe(false);
    expect(transferSchema.safeParse({ type: 'LINK', id, text: 'javascript:alert(1)' }).success).toBe(false);
  });
  it('detects HTTP(S) links without interpreting unsafe schemes or prose', () => {
    expect(asLink('https://example.com')).toBe('https://example.com/'); expect(asLink('www.example.com')).toBe('https://www.example.com/');
    for (const value of ['ordinary text', 'https://example.com more', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/a']) expect(asLink(value)).toBeNull();
  });
  it('sanitizes path traversal, control characters, reserved device names and empty names', () => {
    expect(safeFilename('../../report.pdf')).toBe('report.pdf'); expect(safeFilename('C:\\a\\photo.png')).toBe('photo.png');
    expect(safeFilename('CON.txt')).toBe('_CON.txt'); expect(safeFilename('...')).toBe('download'); expect(safeFilename('<a>\u202e.txt')).toBe('_a__.txt');
  });
});
describe('binary chunk assembly', () => {
  it('reassembles bytes exactly with UUID and sequence framing', async () => {
    const bytes = Uint8Array.from({ length: CHUNK_SIZE * 3 + 19 }, (_, i) => i % 251);
    const assembler = new FileAssembler({ type: 'FILE_START', id, name: 'report.pdf', size: bytes.length, mime: 'application/pdf' }, 100000);
    let sequence = 0;
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = decodeChunk(encodeChunk(id, sequence++, bytes.slice(offset, offset + CHUNK_SIZE).buffer));
      expect(chunk.id).toBe(id); assembler.append(chunk.sequence, chunk.bytes);
    }
    expect(new Uint8Array(await assembler.finish().arrayBuffer())).toEqual(bytes);
  });
  it('rejects out-of-order, oversized, truncated and malformed chunks', () => {
    const metadata = { type: 'FILE_START' as const, id, name: 'a', size: 2, mime: '' };
    expect(() => new FileAssembler(metadata, 1)).toThrow();
    const assembler = new FileAssembler(metadata, 10);
    expect(() => assembler.append(1, new ArrayBuffer(1))).toThrow();
    expect(() => assembler.append(0, new ArrayBuffer(3))).toThrow();
    assembler.append(0, new ArrayBuffer(1)); expect(() => assembler.finish()).toThrow();
    expect(() => decodeChunk(new ArrayBuffer(40))).toThrow();
    expect(() => encodeChunk(id, 0, new ArrayBuffer(CHUNK_SIZE + 1))).toThrow();
    expect(() => encodeChunk(id, 0, new ArrayBuffer(0))).toThrow();
    for (const sequence of [-1, 0.5, 0x100000000, Infinity, NaN]) expect(() => encodeChunk(id, sequence, new ArrayBuffer(1))).toThrow();
  });
  it('frames exactly the selected buffer view and owns the encoded bytes', () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);
    const packet = encodeChunk(id, 0xffffffff, source.subarray(1, 4));
    source.fill(0);
    const chunk = decodeChunk(packet);
    expect(chunk.sequence).toBe(0xffffffff);
    expect(new Uint8Array(chunk.bytes)).toEqual(new Uint8Array([2, 3, 4]));
  });
  it('supports an empty file', () => {
    expect(new FileAssembler({ type: 'FILE_START', id, name: 'empty', size: 0, mime: '' }, 10).finish().size).toBe(0);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { Transfers } from '../client/transfers';
import { CHUNK_SIZE, decodeChunk, encodeChunk, MAX_HISTORY, type PublicConfig, type Transfer } from '../shared/protocol';

class Channel extends EventTarget {
  readyState = 'open'; bufferedAmount = 0; bufferedAmountLowThreshold = 0; binaryType = 'arraybuffer';
  sent: (string | ArrayBuffer)[] = [];
  onmessage?: (event: { data: unknown }) => void;
  send(value: string | ArrayBuffer) { this.sent.push(value); }
  close() { this.readyState = 'closed'; }
  receive(data: unknown) { this.onmessage?.({ data: typeof data === 'object' && !(data instanceof ArrayBuffer) ? JSON.stringify(data) : data }); }
}
const config: PublicConfig = { publicUrl: '', maxFileSize: 100000, maxSessionBytes: 200000, iceServers: [] };
const id = '81b469ac-4ac0-4dd9-8a1f-54d2e332a11a';
const disposals: (() => void)[] = [];
afterEach(() => { disposals.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function setup(settings = config) {
  const channel = new Channel(); let records: Transfer[] = []; const errors: string[] = [];
  const engine = new Transfers(channel as unknown as RTCDataChannel, settings, value => { records = value; }, value => errors.push(value));
  disposals.push(() => engine.destroy());
  return { channel, engine, records: () => records, errors };
}
it('marks outgoing text complete only after receiver acknowledgment', async () => {
  const app = setup(); app.engine.sendText('ping');
  expect(app.records()[0].status).toBe('sending');
  app.channel.receive({ type: 'TRANSFER_COMPLETE', id: app.records()[0].id });
  await vi.waitFor(() => expect(app.records()[0].status).toBe('complete'));
});
it('chunks outgoing files and waits for completion confirmation', async () => {
  const app = setup(); const file = new File([new Uint8Array(CHUNK_SIZE * 2 + 8)], 'report.pdf', { type: 'application/pdf' });
  app.engine.sendFiles([file]);
  await vi.waitFor(() => expect(app.records()[0].status).toBe('confirming'));
  expect(app.channel.sent.filter(item => item instanceof ArrayBuffer)).toHaveLength(3);
  expect(app.records()[0].bytes).toBe(file.size);
  app.channel.receive({ type: 'TRANSFER_COMPLETE', id: app.records()[0].id });
  await vi.waitFor(() => expect(app.records()[0].status).toBe('complete'));
});
it('reads large files in bounded batches while preserving every wire byte and sequence', async () => {
  const source = Uint8Array.from({ length: 1024 * 1024 + 37 }, (_, index) => index % 251);
  const app = setup({ ...config, maxFileSize: source.length });
  const file = new File([source], 'large.bin');
  const reads = vi.spyOn(file, 'slice');
  app.engine.sendFiles([file]);
  await vi.waitFor(() => expect(app.records()[0].status).toBe('confirming'));
  const packets = app.channel.sent.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer);
  const received = new Uint8Array(source.length);
  let offset = 0;
  packets.forEach((packet, index) => {
    const chunk = decodeChunk(packet);
    expect(chunk.sequence).toBe(index);
    expect(chunk.id).toBe(app.records()[0].id);
    received.set(new Uint8Array(chunk.bytes), offset);
    offset += chunk.bytes.byteLength;
  });
  expect(offset).toBe(source.length);
  expect(received).toEqual(source);
  expect(reads).toHaveBeenCalledTimes(5);
  expect(app.records()[0].bytes).toBe(source.length);
});
it('reassembles a received file, creates a Blob, then acknowledges receipt', async () => {
  const app = setup();
  app.channel.receive({ type: 'FILE_START', id, name: '../../hello.txt', size: 5, mime: 'text/plain' });
  app.channel.receive(encodeChunk(id, 0, new TextEncoder().encode('hello').buffer));
  app.channel.receive({ type: 'FILE_END', id });
  await vi.waitFor(() => expect(app.records()[0].status).toBe('complete'));
  expect(app.records()[0].name).toBe('hello.txt');
  expect(await (await fetch(app.records()[0].url!)).text()).toBe('hello');
  expect(JSON.parse(app.channel.sent.at(-1) as string)).toEqual({ type: 'TRANSFER_COMPLETE', id });
});
it('cancels both directions and ignores already buffered chunks', async () => {
  const app = setup();
  app.channel.receive({ type: 'FILE_START', id, name: 'a', size: 2, mime: '' });
  await vi.waitFor(() => expect(app.records()).toHaveLength(1));
  app.engine.cancel(id);
  app.channel.receive(encodeChunk(id, 0, new ArrayBuffer(2))); app.channel.receive({ type: 'FILE_END', id });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(app.records()[0].status).toBe('cancelled'); expect(app.records()[0].url).toBeUndefined();
  expect(JSON.parse(app.channel.sent.at(-1) as string).type).toBe('TRANSFER_CANCEL');
});
it('enforces incoming limits and frees budget when history is cleared', async () => {
  const app = setup({ ...config, maxSessionBytes: 1 });
  app.channel.receive({ type: 'FILE_START', id, name: 'a', size: 2, mime: '' });
  await vi.waitFor(() => expect(app.records()[0].status).toBe('error'));
  expect(JSON.parse(app.channel.sent.at(-1) as string).type).toBe('TRANSFER_ERROR');
  app.engine.clearHistory(); expect(app.records()).toHaveLength(0);
});
it('stops a blocked sender when cancelled and marks interrupted text as failed', async () => {
  const app = setup(); app.channel.bufferedAmount = 2000000;
  app.engine.sendFiles([new File([new Uint8Array(50)], 'a')]);
  app.engine.cancel(app.records()[0].id);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(app.channel.sent.filter(item => item instanceof ArrayBuffer)).toHaveLength(0);
  app.engine.sendText('pending'); app.engine.disconnect();
  expect(app.records().map(item => item.status)).toEqual(['cancelled', 'error']);
});
it('can clear a cancelled buffered transfer and continue the queued file', async () => {
  vi.useFakeTimers();
  const app = setup(); app.channel.bufferedAmount = 2000000;
  app.engine.sendFiles([new File(['cancel'], 'first.txt'), new File(['keep'], 'second.txt')]);
  const cancelledId = app.records()[0].id;
  app.engine.cancel(cancelledId);
  app.engine.clearHistory();
  await vi.advanceTimersByTimeAsync(101);
  app.channel.bufferedAmount = 0;
  app.channel.dispatchEvent(new Event('bufferedamountlow'));
  await vi.waitFor(() => expect(app.records()[0].status).toBe('confirming'));
  expect(app.records()).toHaveLength(1);
  expect(app.records()[0].name).toBe('second.txt');
  const controls = app.channel.sent.filter((item): item is string => typeof item === 'string').map(item => JSON.parse(item));
  expect(controls.filter(message => message.type === 'TRANSFER_CANCEL' && message.id === cancelledId)).toHaveLength(1);
  expect(app.channel.sent.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer).map(packet => decodeChunk(packet).id)).toEqual([app.records()[0].id]);
});
it('times out an unacknowledged transfer', () => {
  vi.useFakeTimers(); const app = setup(); app.engine.sendText('timeout');
  vi.advanceTimersByTime(60001); expect(app.records()[0].status).toBe('error');
});
it('does not process a pending Blob message after the transfer engine is destroyed', async () => {
  const app = setup();
  let finishRead!: (value: ArrayBuffer) => void;
  const blob = new Blob([new Uint8Array([1])]);
  const read = vi.spyOn(blob, 'arrayBuffer').mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  app.channel.onmessage?.({ data: blob });
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  app.engine.destroy();
  finishRead(new ArrayBuffer(1));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(app.errors).toEqual([]);
  expect(app.records()).toEqual([]);
});
it('still sends accepted files when a multi-file selection reaches the history limit', async () => {
  const app = setup();
  for (let index = 0; index < MAX_HISTORY - 1; index++) {
    app.channel.receive({ type: 'TEXT', id: crypto.randomUUID(), text: `item ${index}` });
  }
  await vi.waitFor(() => expect(app.records()).toHaveLength(MAX_HISTORY - 1));
  app.engine.sendFiles([new File(['first'], 'first.txt'), new File(['second'], 'second.txt')]);
  await vi.waitFor(() => expect(app.records().at(-1)?.status).toBe('confirming'));
  expect(app.records().at(-1)?.name).toBe('first.txt');
  expect(app.records()).toHaveLength(MAX_HISTORY);
  expect(app.errors).toContain('전송 기록이 가득 찼습니다. 기록을 비우고 다시 시도하세요.');
});
it.each(['TEXT', 'LINK', 'FILE_START'] as const)('rejects %s when receiver history is full without closing the connection', async type => {
  const app = setup();
  for (let index = 0; index < MAX_HISTORY; index++) {
    app.channel.receive({ type: 'TEXT', id: crypto.randomUUID(), text: `item ${index}` });
  }
  await vi.waitFor(() => expect(app.records()).toHaveLength(MAX_HISTORY));
  app.channel.receive(type === 'FILE_START'
    ? { type, id, name: 'excess.txt', size: 1, mime: 'text/plain' }
    : { type, id, text: type === 'LINK' ? 'https://example.com/' : 'excess' });
  await vi.waitFor(() => expect(JSON.parse(app.channel.sent.at(-1) as string).type).toBe('TRANSFER_ERROR'));
  expect(JSON.parse(app.channel.sent.at(-1) as string).id).toBe(id);
  expect(app.records()).toHaveLength(MAX_HISTORY);
  expect(app.channel.readyState).toBe('open');
  if (type === 'FILE_START') {
    app.channel.receive(encodeChunk(id, 0, new Uint8Array([1])));
    app.channel.receive({ type: 'FILE_END', id });
  }
  app.engine.clearHistory();
  app.channel.receive({ type: 'TEXT', id: crypto.randomUUID(), text: 'receiving again' });
  await vi.waitFor(() => expect(app.records()).toHaveLength(1));
  expect(app.records()[0].text).toBe('receiving again');
  expect(app.records()[0].status).toBe('complete');
  expect(app.channel.readyState).toBe('open');
});

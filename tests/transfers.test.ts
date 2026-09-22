import { afterEach, expect, it, vi } from 'vitest';
import { Transfers } from '../client/transfers';
import { CHUNK_SIZE, encodeChunk, type PublicConfig, type Transfer } from '../shared/protocol';

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
it('times out an unacknowledged transfer', () => {
  vi.useFakeTimers(); const app = setup(); app.engine.sendText('timeout');
  vi.advanceTimersByTime(60001); expect(app.records()[0].status).toBe('error');
});

import {
  asLink, CHUNK_SIZE, decodeChunk, encodeChunk, FileAssembler, isActive, MAX_HISTORY,
  safeFilename, transferSchema, type PublicConfig, type Transfer, type TransferMessage,
} from '../shared/protocol';

const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;
const READ_SIZE = CHUNK_SIZE * 16;
const TIMEOUT = 60000;

export class Transfers {
  private records = new Map<string, Transfer>();
  private incoming = new Map<string, { assembler: FileAssembler; timer: ReturnType<typeof setTimeout> }>();
  private acknowledgements = new Map<string, ReturnType<typeof setTimeout>>();
  private queued: { id: string; file: File }[] = [];
  private pumping = false;
  private disposed = false;
  private retainedBytes = 0;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private receiveChain = Promise.resolve();

  constructor(private channel: RTCDataChannel, private config: PublicConfig,
    private changed: (items: Transfer[]) => void, private error: (message: string) => void) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = LOW_WATER;
    channel.onmessage = event => {
      this.receiveChain = this.receiveChain.then(async () => {
        if (this.disposed) return;
        try {
          const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
          if (!this.disposed) this.receive(data);
        }
        catch (error) {
          this.error(error instanceof Error ? error.message : '잘못된 전송 데이터입니다.');
          this.disconnect();
          channel.close();
        }
      });
    };
  }

  private publish(immediate = true) {
    if (this.publishTimer) { if (!immediate) return; clearTimeout(this.publishTimer); }
    if (immediate) { this.publishTimer = undefined; this.changed([...this.records.values()]); }
    else this.publishTimer = setTimeout(() => { this.publishTimer = undefined; this.changed([...this.records.values()]); }, 80);
  }
  private add(item: Transfer) {
    if (this.records.has(item.id)) throw new Error('중복 전송 ID입니다.');
    if (this.records.size >= MAX_HISTORY) throw new Error('전송 기록이 가득 찼습니다. 기록을 비우고 다시 시도하세요.');
    this.records.set(item.id, item);
    this.publish();
  }
  private update(id: string, patch: Partial<Transfer>, immediate = true) {
    const item = this.records.get(id);
    if (!item || !isActive(item.status)) return;
    this.records.set(id, { ...item, ...patch });
    this.publish(immediate);
  }
  private send(message: TransferMessage) {
    if (this.disposed || this.channel.readyState !== 'open') throw new Error('상대 기기와 연결되어 있지 않습니다.');
    this.channel.send(JSON.stringify(message));
  }
  private awaitAck(id: string) {
    this.acknowledgements.set(id, setTimeout(() => {
      this.acknowledgements.delete(id);
      this.update(id, { status: 'error', error: '상대 기기의 수신 확인 시간이 초과되었습니다.' });
      try { this.send({ type: 'TRANSFER_CANCEL', id }); } catch { /* connection already closed */ }
    }, TIMEOUT));
  }
  private clearAck(id: string) {
    clearTimeout(this.acknowledgements.get(id)); this.acknowledgements.delete(id);
  }
  sendText(text: string) {
    const link = asLink(text);
    const message = transferSchema.parse({ type: link ? 'LINK' : 'TEXT', id: crypto.randomUUID(), text: link || text.trim() }) as Extract<TransferMessage, { text: string }>;
    this.add({ id: message.id, text: message.text, kind: link ? 'link' : 'text', direction: 'sent', time: Date.now(), status: 'sending', bytes: 0 });
    try { this.send(message); this.awaitAck(message.id); }
    catch (error) { this.update(message.id, { status: 'error' }); throw error; }
  }
  sendFiles(files: File[]) {
    for (const file of files) {
      if (this.records.size >= MAX_HISTORY) { this.error('전송 기록이 가득 찼습니다. 기록을 비우고 다시 시도하세요.'); break; }
      if (file.size > this.config.maxFileSize) { this.error(`${file.name}: 최대 파일 크기를 초과했습니다.`); continue; }
      if (this.queued.length >= 20) { this.error('한 번에 최대 20개 파일을 대기열에 넣을 수 있습니다.'); break; }
      const id = crypto.randomUUID();
      this.add({ id, kind: 'file', name: safeFilename(file.name), size: file.size, mime: file.type, direction: 'sent', time: Date.now(), status: 'sending', bytes: 0 });
      this.queued.push({ id, file });
    }
    void this.pump();
  }

  private async waitForBuffer(id: string) {
    const start = Date.now();
    while (this.channel.bufferedAmount > HIGH_WATER) {
      if (this.disposed || this.channel.readyState !== 'open') throw new Error('연결이 끊겼습니다.');
      if (this.records.get(id)?.status !== 'sending') return;
      if (Date.now() - start > TIMEOUT) throw new Error('파일 전송 대기 시간이 초과되었습니다.');
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); this.channel.removeEventListener('bufferedamountlow', done); resolve(); };
        const timer = setTimeout(done, 100);
        this.channel.addEventListener('bufferedamountlow', done, { once: true });
      });
    }
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queued.length && !this.disposed) {
        const { id, file } = this.queued.shift()!;
        const active = () => !this.disposed && this.records.get(id)?.status === 'sending';
        if (!active()) continue;
        try {
          this.send({ type: 'FILE_START', id, name: safeFilename(file.name), size: file.size, mime: file.type.slice(0, 128) });
          let sequence = 0;
          // Read bounded windows to avoid a separate disk read for every wire chunk.
          for (let offset = 0; offset < file.size && active(); offset += READ_SIZE) {
            await this.waitForBuffer(id);
            if (!active()) break;
            const window = await file.slice(offset, offset + READ_SIZE).arrayBuffer();
            for (let position = 0; position < window.byteLength && active(); position += CHUNK_SIZE) {
              await this.waitForBuffer(id);
              if (!active()) break;
              const bytes = new Uint8Array(window, position, Math.min(CHUNK_SIZE, window.byteLength - position));
              this.channel.send(encodeChunk(id, sequence++, bytes));
              this.update(id, { bytes: offset + position + bytes.byteLength }, false);
            }
          }
          if (active()) {
            this.send({ type: 'FILE_END', id });
            this.update(id, { status: 'confirming' });
            this.awaitAck(id);
          }
        } catch (error) {
          this.update(id, { status: 'error', error: error instanceof Error ? error.message : '파일 전송에 실패했습니다.' });
          try { this.send({ type: 'TRANSFER_CANCEL', id }); } catch { /* offline */ }
        }
      }
    } finally { this.pumping = false; }
  }

  private incomingTimer(id: string) {
    return setTimeout(() => {
      this.releaseIncoming(id);
      this.update(id, { status: 'error', error: '파일 수신 시간이 초과되었습니다.' });
      try { this.send({ type: 'TRANSFER_ERROR', id, message: '파일 수신 시간이 초과되었습니다.' }); } catch { /* offline */ }
    }, TIMEOUT);
  }
  private releaseIncoming(id: string) {
    const incoming = this.incoming.get(id);
    if (!incoming) return;
    clearTimeout(incoming.timer);
    this.retainedBytes -= incoming.assembler.metadata.size;
    this.incoming.delete(id);
  }
  private receive(data: unknown) {
    if (data instanceof ArrayBuffer) {
      const chunk = decodeChunk(data);
      const incoming = this.incoming.get(chunk.id);
      // Buffered chunks may arrive after cancellation; discard them.
      if (!incoming) return;
      incoming.assembler.append(chunk.sequence, chunk.bytes);
      clearTimeout(incoming.timer); incoming.timer = this.incomingTimer(chunk.id);
      this.update(chunk.id, { bytes: incoming.assembler.bytes }, false);
      return;
    }
    if (typeof data !== 'string' || data.length > 50000) throw new Error('잘못된 전송 데이터입니다.');
    const message = transferSchema.parse(JSON.parse(data));
    const { id } = message;
    if (message.type === 'TEXT' || message.type === 'LINK' || message.type === 'FILE_START') {
      if (this.records.has(id)) throw new Error('중복 전송 ID입니다.');
      if (this.records.size >= MAX_HISTORY) {
        this.error('전송 기록이 가득 찼습니다. 기록을 비우고 다시 시도하세요.');
        this.send({ type: 'TRANSFER_ERROR', id, message: '상대 기기의 전송 기록이 가득 찼습니다. 상대 기기에서 기록을 비운 뒤 다시 보내세요.' });
        return;
      }
    }
    if (message.type === 'TEXT' || message.type === 'LINK') {
      this.add({ id, kind: message.type === 'LINK' ? 'link' : 'text', text: message.text, direction: 'received', time: Date.now(), status: 'complete', bytes: 0 });
      this.send({ type: 'TRANSFER_COMPLETE', id });
    } else if (message.type === 'FILE_START') {
      this.add({ id, kind: 'file', name: safeFilename(message.name), size: message.size, mime: message.mime, direction: 'received', time: Date.now(), status: 'receiving', bytes: 0 });
      if (message.size > this.config.maxFileSize || this.retainedBytes + message.size > this.config.maxSessionBytes || this.incoming.size >= 2) {
        const error = '수신 용량 제한입니다. 기록을 비우거나 더 작은 파일을 보내세요.';
        this.update(id, { status: 'error', error });
        this.send({ type: 'TRANSFER_ERROR', id, message: error });
        return;
      }
      this.incoming.set(id, { assembler: new FileAssembler(message, this.config.maxFileSize), timer: this.incomingTimer(id) });
      this.retainedBytes += message.size;
    } else if (message.type === 'FILE_END') {
      const incoming = this.incoming.get(id);
      if (!incoming) return;
      const blob = incoming.assembler.finish();
      clearTimeout(incoming.timer);
      this.incoming.delete(id); // Keep the completed Blob counted until history is cleared.
      this.update(id, { status: 'complete', url: URL.createObjectURL(blob), bytes: blob.size });
      this.send({ type: 'TRANSFER_COMPLETE', id });
    } else if (message.type === 'TRANSFER_COMPLETE') {
      const item = this.records.get(id);
      if (item?.direction !== 'sent' || (item.kind === 'file' && item.status !== 'confirming')) return;
      this.clearAck(id); this.update(id, { status: 'complete' });
    } else {
      this.releaseIncoming(id); this.clearAck(id);
      this.update(id, { status: message.type === 'TRANSFER_CANCEL' ? 'cancelled' : 'error', error: message.type === 'TRANSFER_ERROR' ? message.message : undefined });
    }
  }
  cancel(id: string) {
    if (!isActive(this.records.get(id)?.status || 'error')) return;
    this.releaseIncoming(id); this.clearAck(id);
    this.update(id, { status: 'cancelled' });
    this.queued = this.queued.filter(item => item.id !== id);
    try { this.send({ type: 'TRANSFER_CANCEL', id }); } catch { /* offline */ }
  }
  clearHistory() {
    for (const [id, item] of this.records) {
      if (isActive(item.status)) continue;
      if (item.url) { URL.revokeObjectURL(item.url); this.retainedBytes -= item.size || 0; }
      this.records.delete(id);
    }
    this.publish();
  }
  disconnect() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.incoming.keys()) this.releaseIncoming(id);
    for (const id of this.acknowledgements.keys()) this.clearAck(id);
    this.queued = [];
    for (const [id, item] of this.records) if (isActive(item.status)) this.records.set(id, { ...item, status: 'error', error: '연결이 끊겨 전송을 중단했습니다.' });
    this.publish();
  }
  destroy() { this.disconnect(); this.clearHistory(); }
}

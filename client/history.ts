import { isActive, MAX_HISTORY, type Transfer } from '../shared/protocol';

const DATABASE = 'quickdrop-history';
const STORE = 'pairs';
const MAX_PAIRS = 10;
const MAX_BYTES = 200 * 1024 * 1024;
type Pair = { id: string; updatedAt: number; items: Transfer[] };
let volatileDeviceId: string | undefined;
let writes: Promise<unknown> = Promise.resolve();

// A browser-profile label for grouping history, not verified identity.
// The secret resume token has a separate authentication role.
export function deviceId() {
  try {
    const saved = localStorage.getItem('quickdrop-device');
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const id = crypto.randomUUID(); localStorage.setItem('quickdrop-device', id); return id;
  } catch { return volatileDeviceId ||= crypto.randomUUID(); }
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Local history unavailable')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('History open timeout')); }, 5000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onblocked = () => { expired = true; clearTimeout(timer); reject(new Error('History database is busy')); };
    request.onsuccess = () => { clearTimeout(timer); if (expired) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export class PairHistory {
  private signature?: string;
  private warned = false;
  private disabled = false;
  private pending?: Pair;
  private scheduled = false;
  constructor(private id: string, private warning: (message: string) => void) {}
  private unavailable() {
    this.disabled = true;
    if (!this.warned) { this.warned = true; this.warning('브라우저의 기록 저장 공간을 사용할 수 없습니다. 현재 기록은 이 페이지에서만 유지됩니다.'); }
  }
  async load(): Promise<Transfer[]> {
    if (this.disabled) return [];
    try {
      await writes;
      const db = await open();
      const result = await new Promise<Pair | undefined>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readonly');
        const request = transaction.objectStore(STORE).get(this.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      });
      return (result?.items || []).slice(-MAX_HISTORY).map(item => ({ ...item, url: item.blob ? URL.createObjectURL(item.blob) : undefined }));
    } catch { this.unavailable(); return []; }
  }
  save(items: Transfer[]) {
    const finished = items.filter(item => !isActive(item.status)).slice(-MAX_HISTORY);
    const signature = finished.map(item => `${item.id}:${item.status}:${item.blob?.size || 0}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    if (this.disabled) return;
    this.pending = { id: this.id, updatedAt: Date.now(), items: finished.map(({ url: _url, ...item }) => item) };
    if (this.scheduled) return;
    this.scheduled = true;
    writes = writes.catch(() => undefined).then(async () => {
      try {
        while (this.pending && !this.disabled) {
          const pair = this.pending; this.pending = undefined;
          await this.store(pair);
        }
      } catch { this.unavailable(); }
      finally { this.pending = undefined; this.scheduled = false; }
    });
  }
  private async store(pair: Pair, metadataOnly = false): Promise<void> {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        if (!pair.items.length) {
          store.delete(pair.id);
          transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
          return;
        }
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const pairs = (request.result as Pair[]).filter(value => value.id !== pair.id);
            pairs.push(pair); pairs.sort((a, b) => b.updatedAt - a.updatedAt);
            pairs.slice(MAX_PAIRS).forEach(value => store.delete(value.id));
            const retained = pairs.slice(0, MAX_PAIRS);
            let bytes = retained.reduce((total, value) => total + value.items.reduce((sum, item) => sum + (item.blob?.size || 0), 0), 0);
            // Evict old file bytes first; keep their transfer metadata.
            for (const value of [...retained].reverse()) {
              let changed = value.id === pair.id;
              value.items = value.items.map(item => {
                if (item.blob && (metadataOnly || bytes > MAX_BYTES)) {
                  changed = true; bytes -= item.blob.size;
                  const { blob: _blob, ...metadata } = item; return metadata;
                }
                return item;
              });
              if (changed) store.put(value);
            }
          } catch (error) { transaction.abort(); reject(error); }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch (error) {
      if (!metadataOnly && pair.items.some(item => item.blob)) {
        await this.store(pair, true);
        this.warning('저장 공간이 부족해 파일 내용 대신 전송 내역만 보관했습니다. 필요한 파일은 다운로드해 주세요.');
      } else throw error;
    } finally { db.close(); }
  }
}

import { Zip, ZipPassThrough } from 'fflate';
import { MAX_HISTORY, safeFilename } from '../shared/protocol';
import { isDownloadable, type ReceivedFile } from './downloads';

const READ_SIZE = 256 * 1024;
const MAX_BYTES = 200 * 1024 * 1024;

function uniqueName(value: string, used: Set<string>) {
  const name = safeFilename(value.normalize('NFC'));
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let number = 2; used.has(candidate.toLocaleLowerCase('en-US')); number++) candidate = `${stem} (${number})${extension}`;
  used.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

// STORE entries avoid expensive recompression of images/videos. Read one bounded
// slice at a time, yielding between slices so progress and cancellation stay usable.
export async function createDownloadZip(files: ReceivedFile[], signal: AbortSignal, progress: (percent: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  if (!files.length || files.length > MAX_HISTORY || files.some(file => !isDownloadable(file))) throw new Error('다운로드할 받은 파일을 선택하세요.');
  const total = files.reduce((bytes, file) => bytes + file.blob.size, 0);
  if (total > MAX_BYTES) throw new Error('한 번에 다운로드할 수 있는 파일 합계는 200MB입니다. 나누어 선택하세요.');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    parts.push(chunk);
    if (final) finished = true;
  });
  const names = new Set<string>();
  let read = 0;
  progress(0);
  try {
    for (let index = 0; index < files.length; index++) {
      signal.throwIfAborted();
      const file = files[index];
      const entry = new ZipPassThrough(uniqueName(file.name || 'download', names));
      zip.add(entry);
      if (!file.blob.size) entry.push(new Uint8Array(0), true);
      for (let offset = 0; offset < file.blob.size; offset += READ_SIZE) {
        signal.throwIfAborted();
        const chunk = new Uint8Array(await file.blob.slice(offset, offset + READ_SIZE).arrayBuffer());
        signal.throwIfAborted();
        entry.push(chunk, offset + chunk.length === file.blob.size);
        read += chunk.length;
        progress(Math.min(99, Math.floor(read / total * 100)));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!total) progress(Math.floor((index + 1) / files.length * 99));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    zip.end();
    if (!finished) throw new Error('ZIP 파일을 완성하지 못했습니다.');
    const result = new Blob(parts, { type: 'application/zip' });
    progress(100);
    return result;
  } finally {
    zip.terminate();
    parts.length = 0;
  }
}

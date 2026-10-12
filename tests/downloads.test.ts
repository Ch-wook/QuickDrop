import { expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { createDownloadZip } from '../client/download-zip';
import { isDownloadable, type ReceivedFile } from '../client/downloads';

function file(name: string, content: BlobPart = 'file contents'): ReceivedFile {
  const blob = new Blob([content]);
  return { id: crypto.randomUUID(), direction: 'received', kind: 'file', status: 'complete', time: Date.now(), bytes: blob.size, size: blob.size, blob, name };
}
async function extract(files: ReceivedFile[]) {
  return unzipSync(new Uint8Array(await (await createDownloadZip(files, new AbortController().signal, () => undefined)).arrayBuffer()));
}

it('creates a ZIP that preserves binary bytes, Unicode names and empty files', async () => {
  const binary = Uint8Array.from({ length: 700000 }, (_, i) => i % 251);
  const result = await extract([file('사진.bin', binary), file('empty.txt', '')]);
  expect(result['사진.bin']).toEqual(binary);
  expect(result['empty.txt']).toEqual(new Uint8Array(0));
});

it('keeps duplicate names without overwriting and flattens unsafe paths', async () => {
  const result = await extract([file('report.txt', 'one'), file('REPORT.txt', 'two'), file('report (2).txt', 'three'), file('../../사진.txt', 'four'), file('CON.txt', 'five')]);
  expect(Object.keys(result)).toEqual(['report.txt', 'REPORT (2).txt', 'report (2) (2).txt', '사진.txt', '_CON.txt']);
  expect(Object.values(result).map(value => new TextDecoder().decode(value))).toEqual(['one', 'two', 'three', 'four', 'five']);
});

it('excludes sent files, missing content, text, failed and unfinished transfers', async () => {
  const ready = file('ready.txt');
  const excluded = [{ ...ready, direction: 'sent' as const }, { ...ready, blob: undefined }, { ...ready, kind: 'text' as const }, { ...ready, status: 'receiving' as const }, { ...ready, status: 'error' as const }];
  expect(isDownloadable(ready)).toBe(true);
  expect(excluded.map(isDownloadable)).toEqual([false, false, false, false, false]);
  await expect(createDownloadZip([{ ...ready, direction: 'sent' }], new AbortController().signal, () => undefined)).rejects.toThrow('받은 파일');
});

it('reads bounded slices and reports completion only after the ZIP is finished', async () => {
  const item = file('large.bin', new Uint8Array(1024 * 1024 + 17));
  const slice = vi.spyOn(item.blob, 'slice');
  const wholeRead = vi.spyOn(item.blob, 'arrayBuffer');
  const progress: number[] = [];
  await createDownloadZip([item], new AbortController().signal, value => progress.push(value));
  expect(wholeRead).not.toHaveBeenCalled();
  expect(slice.mock.calls.every(([start, end]) => end! - start! <= 256 * 1024)).toBe(true);
  expect(slice).toHaveBeenCalledTimes(5);
  expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100);
  expect(progress.slice(0, -1).every(value => value < 100)).toBe(true);
});

it('stops reading when cancelled and never emits completed progress', async () => {
  const item = file('cancel.bin', new Uint8Array(1024 * 1024));
  const slice = vi.spyOn(item.blob, 'slice');
  const controller = new AbortController(); const progress: number[] = [];
  await expect(createDownloadZip([item], controller.signal, value => { progress.push(value); if (value > 0) controller.abort(); })).rejects.toMatchObject({ name: 'AbortError' });
  expect(slice).toHaveBeenCalledTimes(1); expect(progress).not.toContain(100);
});

it('rejects oversized batches before reading file contents', async () => {
  const item = file('huge.bin');
  Object.defineProperty(item.blob, 'size', { value: 200 * 1024 * 1024 + 1 });
  const read = vi.spyOn(item.blob, 'slice');
  await expect(createDownloadZip([item], new AbortController().signal, () => undefined)).rejects.toThrow('200MB');
  expect(read).not.toHaveBeenCalled();
});

it('handles zero-byte batches and propagates read failures without a completed archive', async () => {
  expect(Object.keys(await extract([file('zero-a', ''), file('zero-b', '')]))).toEqual(['zero-a', 'zero-b']);
  const item = file('broken.txt');
  vi.spyOn(item.blob, 'slice').mockImplementation(() => { throw new Error('read failed'); });
  await expect(createDownloadZip([item], new AbortController().signal, () => undefined)).rejects.toThrow('read failed');
});

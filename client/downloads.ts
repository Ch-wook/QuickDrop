import type { Transfer } from '../shared/protocol';

export type ReceivedFile = Transfer & { blob: Blob };

export function isDownloadable(item: Transfer): item is ReceivedFile {
  return item.direction === 'received' && item.kind === 'file' && item.status === 'complete' && !!item.blob;
}

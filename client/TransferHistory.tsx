import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Transfer } from '../shared/protocol';
import { isDownloadable, type ReceivedFile } from './downloads';
import { Icon } from './icons';
import { TransferCard } from './TransferCard';

type Job = { controller: AbortController; files: ReceivedFile[] };
type SavedZip = { url: string; name: string; files: ReceivedFile[] };

export function TransferHistory({ items, copy, cancel, children }: { items: Transfer[]; copy: (value: string) => void; cancel: (id: string) => void; children?: ReactNode }) {
  const files = useMemo(() => items.filter(isDownloadable), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedZip>();
  const job = useRef<Job | undefined>(undefined);
  const savedRef = useRef<SavedZip | undefined>(undefined);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const selectedFiles = files.filter(file => selected.has(file.id));

  const releaseSaved = useCallback(() => {
    if (savedRef.current) URL.revokeObjectURL(savedRef.current.url);
    savedRef.current = undefined;
    setSaved(undefined);
  }, []);
  useEffect(() => () => {
    job.current?.controller.abort();
    job.current = undefined;
    if (savedRef.current) URL.revokeObjectURL(savedRef.current.url);
  }, []);
  useEffect(() => {
    const available = new Map(files.map(file => [file.id, file.blob]));
    const invalid = (list: ReceivedFile[]) => list.some(file => available.get(file.id) !== file.blob);
    setSelected(previous => [...previous].some(id => !available.has(id)) ? new Set([...previous].filter(id => available.has(id))) : previous);
    if (job.current && invalid(job.current.files)) {
      job.current.controller.abort(); job.current = undefined; setWorking(false);
    }
    if (savedRef.current && invalid(savedRef.current.files)) releaseSaved();
  }, [files, releaseSaved]);
  useEffect(() => {
    if (allCheckbox.current) allCheckbox.current.indeterminate = selectedFiles.length > 0 && selectedFiles.length < files.length;
  }, [selectedFiles.length, files.length]);
  const toggle = useCallback((id: string) => setSelected(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  }), []);

  async function download(list: ReceivedFile[]) {
    if (!list.length || job.current) return;
    const current: Job = { controller: new AbortController(), files: list };
    job.current = current; releaseSaved(); setError(''); setProgress(0); setWorking(true);
    try {
      const { createDownloadZip } = await import('./download-zip');
      const blob = await createDownloadZip(list, current.controller.signal, percent => { if (job.current === current) setProgress(percent); });
      if (job.current !== current || current.controller.signal.aborted) return;
      const value: SavedZip = { url: URL.createObjectURL(blob), name: `quickdrop-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`, files: list };
      savedRef.current = value; setSaved(value);
      const link = document.createElement('a'); link.href = value.url; link.download = value.name;
      document.body.append(link); link.click(); link.remove();
    } catch (cause) {
      if (!current.controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'ZIP을 만들 수 없습니다. 파일을 나누어 선택해 다시 시도하세요.');
    } finally {
      if (job.current === current) { job.current = undefined; setWorking(false); }
    }
  }

  return <>
    {files.length > 0 && <div className="download-toolbar" aria-label="받은 파일 다운로드">
      <div className="download-actions">
        <label className="download-select-all"><input ref={allCheckbox} type="checkbox" checked={selectedFiles.length === files.length} disabled={working} onChange={event => setSelected(event.target.checked ? new Set(files.map(file => file.id)) : new Set())} />전체 선택</label>
        <button className="download-button" disabled={working || !selectedFiles.length} onClick={() => void download(selectedFiles)}><Icon name="download" size={15} />선택 다운로드 ({selectedFiles.length})</button>
        <button className="download-button download-all" disabled={working} onClick={() => void download(files)}>전체 다운로드 ({files.length})</button>
      </div>
      <p className="download-hint">보관 중인 받은 파일을 ZIP 하나로 저장해요.</p>
    </div>}
    {working && <div className="zip-progress" role="status"><span>ZIP 준비 중 · {progress}%</span><progress value={progress} max={100} aria-label="ZIP 준비 진행률" /><button onClick={() => { job.current?.controller.abort(); job.current = undefined; setWorking(false); }}>취소</button></div>}
    {saved && <div className="zip-ready" role="status"><span>파일 {saved.files.length}개의 ZIP 다운로드를 시작했어요. 자동으로 저장되지 않으면</span><a href={saved.url} download={saved.name}>ZIP 다시 저장</a></div>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="history" aria-label="전송 기록" aria-live="polite" aria-relevant="additions">
      {children || items.map(item => <TransferCard key={item.id} item={item} copy={copy} cancel={cancel} selected={selected.has(item.id)} select={isDownloadable(item) ? toggle : undefined} selectionDisabled={working} />)}
    </div>
  </>;
}

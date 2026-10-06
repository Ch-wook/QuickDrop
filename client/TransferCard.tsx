import { memo } from 'react';
import { isActive, type Transfer } from '../shared/protocol';
import { Icon } from './icons';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
const labels = { sending: '전송 중', receiving: '수신 중', confirming: '수신 확인 중', complete: '전송 완료', cancelled: '전송 취소', error: '전송 실패' };
export const TransferCard = memo(function TransferCard({ item, copy, cancel }: { item: Transfer; copy: (value: string) => void; cancel: (id: string) => void }) {
  const active = isActive(item.status);
  const percent = item.size ? Math.min(100, Math.floor(item.bytes / item.size * 100)) : item.status === 'complete' ? 100 : 0;
  const preview = item.url && /^(image\/jpeg|image\/png|image\/webp)$/.test(item.mime || '');
  return <article className={`transfer-card ${item.direction}`}>
    <div className="transfer-meta"><span>{item.direction === 'sent' ? '이 기기에서 보냄' : '상대 기기에서 받음'}</span><time dateTime={new Date(item.time).toISOString()}>{new Date(item.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time></div>
    {item.kind === 'file' ? <>
      {preview && <img className="image-preview" src={item.url} alt={item.name || '수신 이미지'} loading="lazy" decoding="async" />}
      <div className="file-row"><span className="file-icon"><Icon name={preview ? 'image' : 'file'} size={24} /></span><div className="file-info"><strong>{item.name}</strong><span>{formatBytes(item.bytes)} / {formatBytes(item.size || 0)}</span></div>
        {active && <button className="icon-button" onClick={() => cancel(item.id)} aria-label={`${item.name} 전송 취소`}><Icon name="close" size={17} /></button>}
        {item.url && <a className="icon-button" href={item.url} download={item.name} aria-label={`${item.name} 다운로드`}><Icon name="download" /></a>}
      </div>
      {active && <div className="progress-row"><progress value={percent} max={100} aria-label={`${item.name} 전송 진행률`} /><span>{percent}%</span></div>}
    </> : <div className="text-content">{item.kind === 'link' ? <a href={item.text} target="_blank" rel="noopener noreferrer">{item.text}<Icon name="external" size={15} /></a> : <p>{item.text}</p>}<button className="icon-button" onClick={() => copy(item.text!)} aria-label="내용 복사"><Icon name="copy" size={17} /></button></div>}
    <div className={`transfer-status ${item.status}`}>{item.status === 'complete' && <Icon name="check" size={13} />}{labels[item.status]}{item.error && <span> · {item.error}</span>}</div>
  </article>;
});

import { useEffect, useState } from 'react';
import type { HistoryRoom } from './history';
import { Icon } from './icons';

export function HistoryRooms({ rooms, activeId, selectedId, connected, select, rename }: {
  rooms: HistoryRoom[]; activeId?: string; selectedId?: string; connected: boolean;
  select: (id?: string) => void; rename: (id: string, name: string) => Promise<void>;
}) {
  const selected = rooms.find(room => room.id === (selectedId || activeId));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(selected?.name || ''); }, [selected?.id, selected?.name]);
  return <nav className="history-rooms" aria-label="기기별 대화방">
    <div className="rooms-heading"><h3>이전 대화방</h3><span>이 브라우저에 보관</span></div>
    <div className="room-list">
      <button className={`room-entry current-room ${!selectedId ? 'selected' : ''}`} aria-pressed={!selectedId} onClick={() => select()}>
        <span className="room-avatar"><Icon name="link" size={17} /></span><span className="room-description"><strong>현재 연결</strong><span>{connected ? '지금 연결된 기기로 보내기' : 'QR 또는 코드로 기기를 연결하세요'}</span></span>
      </button>
      {rooms.map(room => <button key={room.id} className={`room-entry ${selectedId === room.id ? 'selected' : ''}`} aria-label={`${room.name} 기록 열기`} aria-pressed={selectedId === room.id} onClick={() => select(room.id)}>
        <span className="room-avatar"><Icon name="monitor" size={17} /></span><span className="room-description"><strong>{room.name}{room.id === activeId && connected && <i>연결 중</i>}</strong><span>최근: {room.preview}</span></span><span className="room-count">{room.count}개</span>
      </button>)}
    </div>
    {selected && <form className="room-name-form" onSubmit={async event => {
      event.preventDefault(); setSaving(true);
      try { await rename(selected.id, name); } finally { setSaving(false); }
    }}><label className="sr-only" htmlFor="room-name">대화방 이름</label><input id="room-name" value={name} maxLength={30} onChange={event => setName(event.target.value)} /><button disabled={saving || !name.trim() || name.trim() === selected.name}>이름 저장</button></form>}
  </nav>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TEXT_LENGTH, type PublicConfig, type RoomInfo, type Transfer } from '../shared/protocol';
import { PeerSession, type ConnectionStatus } from './peer';
import { Icon } from './icons';
import { formatBytes, TransferCard } from './TransferCard';
import { connectionAccess } from '../shared/connection-url';

const statuses: Record<ConnectionStatus, string> = { starting: '연결 준비 중', waiting: '연결 대기 중', connecting: '기기 연결 중', connected: '상대 기기 연결됨', disconnected: '연결 끊김', expired: '세션 만료', error: '연결 실패' };

export function App() {
  const [config, setConfig] = useState<PublicConfig>();
  const [status, setStatus] = useState<ConnectionStatus>('starting');
  const [room, setRoom] = useState<RoomInfo>();
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [items, setItems] = useState<Transfer[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const session = useRef<PeerSession | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const connected = status === 'connected';
  const joinUrl = room ? `${config?.publicUrl || location.origin}/join/${room.roomId}` : '';
  const phoneReady = connectionAccess(config?.publicUrl || location.origin) === 'ready';
  const terminal = ['error', 'expired', 'disconnected'].includes(status);

  function start(settings: PublicConfig, target?: { roomId?: string; code?: string }) {
    const current = ++generation.current;
    session.current?.destroy();
    setRoom(undefined); setQr(''); setItems([]); setError(''); setText('');
    const peer = new PeerSession(settings, {
      status: value => { if (generation.current === current) { setStatus(value); if (value === 'connected') { setError(''); setTimeout(() => textarea.current?.focus(), 50); } } },
      room: value => { if (generation.current === current) setRoom(value); },
      transfers: value => { if (generation.current === current) setItems(value); },
      error: value => { if (generation.current === current) setError(value); },
    });
    session.current = peer;
    void peer.start(target);
  }
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => {
      abort.abort(); setStatus('error'); setError('서버 응답 시간이 초과되었습니다. 새 연결을 시작하세요.');
    }, 15000);
    fetch('/api/config', { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('서버 설정을 불러올 수 없습니다.');
      const settings: PublicConfig = await response.json();
      if (abort.signal.aborted) return;
      setConfig(settings);
      const match = location.pathname.match(/^\/join\/([^/]+)$/);
      start(settings, match ? { roomId: match[1] } : undefined);
    }).catch(error => { if (!abort.signal.aborted) { setStatus('error'); setError(error.message); } }).finally(() => clearTimeout(timeout));
    const leave = () => session.current?.destroy();
    window.addEventListener('pagehide', leave);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
    window.addEventListener('pageshow', restore);
    return () => { clearTimeout(timeout); abort.abort(); generation.current++; session.current?.destroy(); window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', restore); };
  }, []);
  useEffect(() => {
    if (!joinUrl || !phoneReady) { setQr(''); return; }
    let alive = true;
    import('qrcode').then(module => {
      if (!alive) return;
      return module.default.toDataURL(joinUrl, { width: 232, margin: 4, color: { dark: '#17243b', light: '#ffffff' }, errorCorrectionLevel: 'M' });
    }).then(value => { if (alive && value) setQr(value); }).catch(() => { if (alive) setError('QR 코드를 만들 수 없습니다. 연결 코드를 사용하세요.'); });
    return () => { alive = false; };
  }, [joinUrl, phoneReady]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (help) dialog.current?.showModal(); else dialog.current?.close(); }, [help]);

  const copy = useCallback(async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const node = document.createElement('textarea'); node.value = value; node.style.position = 'fixed'; node.style.opacity = '0'; document.body.append(node); node.select();
        const success = document.execCommand('copy'); node.remove(); if (!success) throw new Error('copy');
      }
      setNotice('클립보드에 복사했습니다.');
    } catch { setError('복사 권한이 없습니다. 내용을 직접 선택해 복사하세요.'); }
  }, []);
  const cancelTransfer = useCallback((id: string) => session.current?.transfers?.cancel(id), []);
  function files(selected: File[]) {
    if (!connected) { setError('다른 기기를 먼저 연결하세요.'); return; }
    try { session.current?.transfers?.sendFiles(selected); } catch (error) { setError(error instanceof Error ? error.message : '파일을 보낼 수 없습니다.'); }
  }
  function sendText() {
    if (!text.trim() || !connected) return;
    try { session.current?.transfers?.sendText(text); setText(''); textarea.current?.focus(); }
    catch (error) { setError(error instanceof Error ? error.message : '텍스트를 보낼 수 없습니다.'); }
  }
  function newSession() { if (!config) { location.href = '/'; return; } history.replaceState(null, '', '/'); start(config); }
  return <div className="app-shell"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); files(Array.from(event.dataTransfer.files)); }}>
    <header className="header"><a className="brand" href="/" aria-label="QuickDrop 홈"><span className="brand-mark"><Icon name="bolt" size={23} /></span>QuickDrop<span className="beta">BETA</span></a><div className="header-right"><span className="private-label"><Icon name="lock" size={14} />나의 기기 사이, 안전하게</span><button ref={helpButton} className="help-button" onClick={() => setHelp(true)}>사용 방법 <span>↗</span></button></div></header>
    <main>
      <section className="intro"><div className="eyebrow"><span />설치도, 로그인도 필요 없이</div><h1>기기 사이, <span>가장 짧은 거리.</span></h1><p>텍스트부터 파일까지. 연결하고, 바로 보내세요.</p></section>
      <div className="workspace">
        <aside className="connection-card panel">
          <div className="panel-heading"><span className="step-number">01</span><h2>기기 연결</h2><span className={`status-pill ${connected ? 'online' : ''}`}><i />{connected ? '연결됨' : '2대 연결'}</span></div>
          {connected ? <div className="connected-visual"><div className="device-pair"><span><Icon name="monitor" size={32} /></span><div className="connection-dots">···<Icon name="check" size={18} />···</div><span><Icon name="phone" size={31} /></span></div><h3>보낼 준비가 되었어요</h3><p>어느 기기에서든 자유롭게<br />텍스트와 파일을 주고받으세요.</p><div className="secure-badge"><Icon name="shield" size={15} />암호화된 WebRTC 연결</div></div> : <>
            <div className="connect-instructions"><h3>{phoneReady ? '다른 기기와 연결하세요' : '휴대폰 연결 주소가 필요해요'}</h3><p>{phoneReady ? '다른 기기의 카메라로 QR을 스캔하세요.' : '현재 주소는 휴대폰 QR 연결에 사용할 수 없어요.'}</p></div>
            <div className={`qr-frame ${terminal ? 'qr-inactive' : ''}`}>
              {qr && !terminal ? <a href={joinUrl} target="_blank" rel="noopener noreferrer" aria-label="연결 링크"><img src={qr} alt="다른 기기에서 스캔할 연결 QR 코드" width="208" height="208" /></a> : <div className="qr-placeholder"><Icon name={terminal ? 'refresh' : 'link'} size={35} /><span>{terminal ? '새 연결을 시작하세요' : !phoneReady ? '두 기기에서 열리는 HTTPS 주소가 필요해요' : '연결 코드를 준비하고 있어요'}</span>{!phoneReady && !terminal && room && <a className="local-connect-link" href={joinUrl} target="_blank" rel="noopener noreferrer" aria-label="연결 링크">이 PC의 다른 창에서 연결 <Icon name="external" size={13} /></a>}</div>}
            </div>
            {!phoneReady && <div className="local-access-note" role="note"><strong>localhost는 현재 기기만 가리켜요.</strong><p>휴대폰 연결은 PC에서 <code>npm run dev:mobile</code>을 실행한 뒤 표시되는 HTTPS 주소에서 시작하세요.</p></div>}
            <div className="connection-code-label">또는 연결 코드를 입력하세요</div><button className="connection-code" data-testid="connection-code" disabled={!room || terminal} onClick={() => room && void copy(room.code)} aria-label="연결 코드 복사"><span>{room && !terminal ? `${room.code.slice(0, 3)} ${room.code.slice(3)}` : '——— ———'}</span><Icon name="copy" size={17} /></button>
            <div className="waiting-status" role="status"><i className={terminal ? 'error-dot' : ''} />{statuses[status]}</div>
            {!!room && !terminal && <button className="copy-link" onClick={() => void copy(joinUrl)}><Icon name="link" size={14} />{phoneReady ? '연결 링크 복사' : '이 PC의 연결 링크 복사'}</button>}
          </>}
          <div className="connection-bottom">
            {connected || terminal ? <button className="secondary-button full-width" onClick={newSession}><Icon name="refresh" size={16} />새 연결 시작</button> : <><div className="divider"><span>연결 코드가 있나요?</span></div><form className="code-form" onSubmit={event => { event.preventDefault(); if (config && code.length === 6) { history.replaceState(null, '', '/'); start(config, { code }); } }}><label className="sr-only" htmlFor="join-code">6자리 연결 코드</label><input id="join-code" inputMode="numeric" autoComplete="off" placeholder="6자리 코드 입력" value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="join-button" aria-label="코드로 연결" disabled={code.length !== 6 || !config}><Icon name="arrow" size={20} /></button></form></>}
          </div>
        </aside>

        <section className="transfer-panel panel" aria-label="자료 전송">
          <div className="panel-heading"><span className="step-number">02</span><h2>자료 보내기</h2><span className="session-label">현재 세션</span>{items.length > 0 && <button className="clear-button" onClick={() => session.current?.transfers?.clearHistory()}>기록 비우기</button>}</div>
          <div className="transfer-body">
            <div className={`connection-banner ${connected ? 'is-connected' : ''}`} role="status"><span className="banner-icon"><Icon name={connected ? 'check' : 'link'} size={17} /></span><span>{connected ? '두 기기가 연결되었습니다. 바로 보내보세요.' : '기기가 연결되면 전송을 시작할 수 있어요.'}</span><i /></div>
            {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="알림 닫기"><Icon name="close" size={15} /></button></div>}
            <div className="history" aria-label="전송 기록" aria-live="polite" aria-relevant="additions">
              {items.length === 0 ? <div className="empty-state"><div className="empty-illustration"><div className="orbit" /><div className="floating-small"><Icon name="image" size={22} /></div><div className="floating-file"><Icon name="file" size={38} /></div><div className="floating-send"><Icon name="send" size={21} /></div></div><h3>{connected ? '첫 번째 자료를 보내보세요' : '옮기고 싶은 것, 무엇이든.'}</h3><p>링크를 붙여넣거나 파일을 끌어다 놓으세요.<br />자료는 연결된 기기로 바로 전달됩니다.</p><div className="type-chips"><span>텍스트</span><span>링크</span><span>이미지</span><span>파일</span></div></div> : items.map(item => <TransferCard key={item.id} item={item} copy={copy} cancel={cancelTransfer} />)}
            </div>
            <div className={`composer ${!connected ? 'inactive' : ''}`}>
              <label className="sr-only" htmlFor="message">보낼 텍스트 또는 링크</label><textarea ref={textarea} id="message" placeholder={connected ? '텍스트나 링크를 입력하세요. 이미지도 붙여넣을 수 있어요.' : '기기 연결 후 텍스트나 링크를 입력하세요.'} value={text} maxLength={MAX_TEXT_LENGTH} disabled={!connected} onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); sendText(); } }} onPaste={event => { const pasted = Array.from(event.clipboardData.files); if (pasted.length) { event.preventDefault(); files(pasted); } }} />
              <div className="composer-toolbar"><input ref={input} className="sr-only" type="file" id="files" multiple disabled={!connected} onChange={event => { files(Array.from(event.target.files || [])); event.target.value = ''; }} /><button className="attach-button" disabled={!connected} onClick={() => input.current?.click()}><Icon name="paperclip" size={18} />파일 첨부</button><label className="sr-only" htmlFor="files">전송할 파일 선택</label><span className="shortcut">Ctrl / ⌘ + Enter</span><button className="send-button" disabled={!connected || !text.trim()} onClick={sendText}>보내기<Icon name="arrow" size={17} /></button></div>
            </div>
            <div className="transfer-footnote"><Icon name="shield" size={13} /><span>서버에 파일을 저장하지 않아요.</span><span className="file-limit">파일당 최대 {formatBytes(config?.maxFileSize || 209715200)}</span></div>
          </div>
        </section>
      </div>
      <section className="benefits" aria-label="QuickDrop의 특징"><div><span className="benefit-icon"><Icon name="bolt" size={19} /></span><div><h3>열고, 연결하고, 끝.</h3><p>앱 설치나 회원가입 없이 바로 시작</p></div></div><div><span className="benefit-icon"><Icon name="lock" size={18} /></span><div><h3>내 자료는 내 기기에만</h3><p>서버 저장 없이 암호화하여 전송</p></div></div><div><span className="benefit-icon"><Icon name="monitor" size={19} /></span><div><h3>어떤 기기에서든</h3><p>PC, 휴대폰, 태블릿 사이 양방향 전송</p></div></div></section>
    </main>
    <footer><span>QuickDrop <span className="footer-dot">·</span> 작은 연결, 가벼운 일상.</span><span><i />두 기기에서 이 페이지를 열어두세요.</span></footer>
    {notice && <div className="toast" role="status"><Icon name="check" size={17} />{notice}</div>}
    {dragging && <div className="drop-overlay"><Icon name="upload" size={55} /><h2>{connected ? '여기에 놓으면 바로 전송됩니다' : '다른 기기를 먼저 연결하세요'}</h2><p>파일은 연결된 기기로 안전하게 전달됩니다.</p></div>}
    <dialog ref={dialog} onCancel={() => setHelp(false)} onClose={() => { setHelp(false); helpButton.current?.focus(); }} aria-labelledby="help-title"><div className="dialog-title"><h2 id="help-title">세 단계면 충분해요</h2><button className="icon-button" onClick={() => setHelp(false)} aria-label="사용 방법 닫기"><Icon name="close" /></button></div><ol><li><strong>두 기기에서 QuickDrop을 여세요.</strong><p>휴대폰, PC, 태블릿 모두 같은 방법으로 사용해요.</p></li><li><strong>QR을 스캔하거나 6자리 코드를 입력하세요.</strong><p>연결됨 표시가 양쪽에 나타날 때까지 기다려주세요.</p></li><li><strong>텍스트, 링크, 파일을 보내세요.</strong><p>파일 첨부, 드래그 앤 드롭, 이미지 붙여넣기를 지원해요.</p></li></ol><div className="help-note">두 브라우저를 계속 열어두세요. 새로고침하거나 새 연결을 시작하면 기록이 사라집니다. 받은 파일은 다운로드 버튼으로 저장할 수 있어요.</div>{['localhost', '127.0.0.1'].includes(location.hostname) && <p className="local-note">현재 로컬 주소로 실행 중입니다. 휴대폰에서 QR로 연결하려면 두 기기에서 접근할 수 있는 HTTPS 주소를 사용하세요.</p>}<button className="primary-button full-width" onClick={() => setHelp(false)}>시작해 볼게요</button></dialog>
  </div>;
}
